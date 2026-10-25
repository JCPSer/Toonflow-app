import { computed, onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { useAssetLibraryStore, type AssetLibraryState, type AssetSortField, type AssetSortOrder, type AssetView } from "@/stores/assetLibrary";
import { AssetRequestError, forgetAssetEntries, getRoots, listAssets, subscribeAssetChanges, toAssetError } from "./api";
import type { AssetEntry, AssetLibraryKind, AssetRoots } from "./types";
import { isSameOrDescendant, normalizeAssetPath, parentAssetPath } from "./types";

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 只把「刚创建/刚挂载」这类瞬时失败当作可重试：
 * 网络不通、目录还不存在（ENOENT）、5xx。权限与参数错误必须立刻如实报出。
 */
/** 记录里保存的目录已经被移动或删除（外部改名、换项目、重建库）。 */
export function isMissingAssetPath(cause: unknown) {
  return cause instanceof AssetRequestError && cause.status === 404 && cause.code === "ENOENT";
}

export function isTransientAssetFailure(cause: unknown) {
  if (cause instanceof AssetRequestError) {
    if (cause.status === undefined || cause.status === 0) return true;
    if (cause.code === "ENOENT") return cause.status === 404;
    return cause.status >= 500;
  }
  return !(cause instanceof Error) || /network|ECONN|timeout/i.test(cause.message);
}

export type SelectionMode = "single" | "toggle" | "range";

export function useAssetLibrary(directory: MaybeRefOrGetter<string | undefined>, active?: MaybeRefOrGetter<boolean>) {
  const store = useAssetLibraryStore();
  const directoryPath = computed(() => toValue(directory) ?? "");
  // 以调用方传入的 directory 为准，保证同一内容区在首页弹窗（全局库）也不串用工作区状态。
  watch(directoryPath, value => { store.stateFor(value || undefined); }, { immediate: true, flush: "sync" });
  const state = computed<AssetLibraryState>(() => store.stateFor(directoryPath.value || undefined));

  const entries = ref<AssetEntry[]>([]);
  const total = ref(0);
  const nextCursor = ref<string>();
  const truncated = ref(false);
  const loading = ref(false);
  const loadingMore = ref(false);
  const error = ref("");
  // ACT: 库根探测的失败与列表失败分开保存，列表加载不能把 root 的真实原因冲掉。
  const rootsError = ref("");
  const indexRebuilding = ref(false);
  const roots = ref<AssetRoots>();
  const rootsFailed = ref(false);
  const query = ref("");
  const treeVersion = ref(0);
  const selection = ref<Set<string>>(new Set());
  const lastSelectedPath = ref<string>();
  const missingEntries = ref<AssetEntry[]>([]);
  const missingTotal = ref(0);
  const syncing = ref(false);
  let listRequest = 0;
  let directoryToken = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let changeController: AbortController | undefined;
  let changeSeen = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let syncDeadline = 0;

  /** 合并展示用；空态优先用更具体的 list 错误。 */
  const displayError = computed(() => error.value || rootsError.value);

  const library = computed(() => state.value.library);
  const view = computed(() => state.value.view);
  const sort = computed(() => state.value.sort);
  const order = computed(() => state.value.order);
  const currentPath = computed(() => state.value.path);
  const currentKey = computed(() => `${state.value.library}:${state.value.path}`);
  const expandedKeys = computed(() => state.value.expanded);
  const selectedEntries = computed(() => entries.value.filter(entry => selection.value.has(entry.path)));
  const projectRoot = computed(() => roots.value?.project ?? null);
  const projectFallback = computed(() => projectRoot.value?.fallback === true);
  const projectFallbackPath = computed(() => projectRoot.value?.path ?? "library-assets");
  const projectAvailable = computed(() => !!directoryPath.value && !rootsFailed.value && (roots.value === undefined || !!projectRoot.value));
  const isSearching = computed(() => !!query.value.trim());
  const emptyKind = computed<"loading" | "directory" | "search" | "rebuilding" | "project-unavailable" | "error">(() => {
    if (loading.value) return "loading";
    if (displayError.value && entries.value.length === 0) return "error";
    if (indexRebuilding.value) return "rebuilding";
    if (isSearching.value) return "search";
    if (state.value.library === "project" && !projectAvailable.value) return "project-unavailable";
    return "directory";
  });
  const searchScopeLabel = computed(() => currentPath.value ? `在 ${currentPath.value} 中搜索` : "搜索全部素材");

  function selector() {
    // ACT: 全局库不传项目目录，项目目录失效时全局库仍可用。
    return {
      library: state.value.library,
      directory: state.value.library === "global" ? undefined : directoryPath.value || undefined,
    };
  }

  function update(patch: Partial<AssetLibraryState>) {
    store.update(patch, directoryPath.value || undefined);
  }

  /** 切换素材库；同库时退化为导航。path 用于"直接落到目标库的某个目录"。 */
  function setLibrary(kind: AssetLibraryKind, path = "") {
    const target = normalizeAssetPath(path);
    if (kind === state.value.library) {
      if (target !== state.value.path) navigate(target);
      return;
    }
    // ACT: 项目库不可用时也允许切过去——空态会说明原因并给出「切换到全局库」，比静默无反应好。
    if (kind === "project" && !directoryPath.value) return;
    // ACT: 切库要清掉上一个库的错误与库根探测结果，否则项目目录失效的横幅会一直挂在全局库上。
    error.value = "";
    rootsError.value = "";
    update({ library: kind, path: target });
    query.value = "";
    clearSelection();
    void loadList(true);
    refreshTree();
  }

  function setView(next: AssetView) {
    update({ view: next });
  }

  function setSort(field: AssetSortField) {
    update({ sort: field });
    void loadList(true);
  }

  function toggleOrder() {
    update({ order: state.value.order === "asc" ? "desc" : "asc" });
    void loadList(true);
  }

  async function loadRoots() {
    const token = ++directoryToken;
    rootsFailed.value = false;
    rootsError.value = "";
    // ACT: 首次打开项目时库根可能刚被创建（并发首开/外部卷刚挂载），失败一次会自动重试再报错。
    for (let attempt = 0; ; attempt++) {
      try {
        const next = await getRoots(directoryPath.value || undefined);
        if (token !== directoryToken) return;
        roots.value = next;
        rootsFailed.value = false;
        if (!next.project && state.value.library === "project") update({ library: "global", path: "" });
        return;
      } catch (cause) {
        if (token !== directoryToken) return;
        if (attempt === 0 && isTransientAssetFailure(cause)) {
          await delay(300);
          continue;
        }
        // 项目库路径解析失败（例如 library 与 library-assets 都被占用）时保留项目库入口以展示可恢复的空状态。
        rootsFailed.value = true;
        rootsError.value = toAssetError(cause).message;
        return;
      }
    }
  }

  function changesEnabled() {
    return active === undefined ? true : toValue(active);
  }

  /** 事件里的目录是否会影响当前视图（自身、祖先或子目录）。 */
  function affectsCurrentDirectory(dir: string) {
    if (!dir) return true;
    const current = state.value.path;
    return current === dir || current.startsWith(`${dir}/`) || dir.startsWith(`${current}/`);
  }

  function flushSilentRefresh() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = undefined;
    syncDeadline = 0;
    refreshTree();
    void loadList(true, { silent: true });
  }

  /** 外部改动只做静默刷新：不清空列表、不闪烁；500ms 合并，连续事件最多推迟 2s。 */
  function scheduleSilentRefresh() {
    const now = Date.now();
    if (!syncDeadline) syncDeadline = now + 2000;
    if (now >= syncDeadline) {
      flushSilentRefresh();
      return;
    }
    if (syncTimer) return;
    syncTimer = setTimeout(flushSilentRefresh, 500);
  }

  async function connectChanges() {
    if (disposed || changeController || !changesEnabled()) return;
    const controller = new AbortController();
    changeController = controller;
    try {
      await subscribeAssetChanges(selector(), event => {
        if (event.type === "ready") {
          // 重连成功说明断流期间的事件已经错过，补一次静默刷新。
          if (changeSeen) void loadList(true, { silent: true });
          changeSeen = true;
          return;
        }
        if (event.type === "change") {
          if (event.dirs.some(affectsCurrentDirectory)) scheduleSilentRefresh();
          return;
        }
        if (event.type === "gone") {
          rootsFailed.value = true;
          rootsError.value = translate("素材库目录已不可用");
        }
      }, controller.signal);
    } catch {
      // 断流/权限问题：交给下面的重连与手动刷新兜底。
    } finally {
      if (changeController === controller) changeController = undefined;
    }
    if (!disposed && changesEnabled()) reconnectTimer = setTimeout(() => void connectChanges(), 3000);
  }

  function stopChanges() {
    changeController?.abort();
    changeController = undefined;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = undefined;
    syncDeadline = 0;
  }

  /** 清理索引里已失效的条目（文件已不在磁盘）。 */
  async function forgetMissing() {
    if (!missingEntries.value.length) return;
    try {
      await forgetAssetEntries(selector(), missingEntries.value.map(entry => entry.path));
      missingEntries.value = [];
      missingTotal.value = 0;
      await loadList(true, { silent: true });
    } catch (cause) {
      error.value = toAssetError(cause).message;
    }
  }

  async function loadList(reset = false, options: { silent?: boolean } = {}) {
    const request = reset ? ++listRequest : listRequest;
    const token = directoryToken;
    if (!reset && (!nextCursor.value || loadingMore.value)) return;
    if (reset) {
      if (options.silent) {
        syncing.value = true;
      } else {
        loading.value = true;
        entries.value = [];
        selection.value = new Set();
        lastSelectedPath.value = undefined;
        nextCursor.value = undefined;
        total.value = 0;
        truncated.value = false;
        missingEntries.value = [];
        missingTotal.value = 0;
      }
    } else {
      loadingMore.value = true;
    }
    error.value = "";
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await listAssets({
            ...selector(),
            path: state.value.path,
            cursor: reset ? undefined : nextCursor.value,
            // 静默刷新时按已加载条数重取，避免把用户翻过的页收回到第一页。
            limit: options.silent ? Math.min(200, Math.max(100, entries.value.length)) : 100,
            sort: state.value.sort,
            order: state.value.order,
            query: query.value.trim() || undefined,
          });
          if (request !== listRequest) return;
          entries.value = reset ? result.items : [...entries.value, ...result.items];
          total.value = result.total;
          truncated.value = result.truncated;
          indexRebuilding.value = result.rebuilding === true;
          nextCursor.value = result.nextCursor;
          // 搜索结果不含 missing，保留上一次的提示，避免搜索时提示条忽隐忽现。
          if (reset && !query.value.trim()) {
            missingEntries.value = result.missing ?? [];
            missingTotal.value = result.missingTotal ?? 0;
          }
          // 已选中的深层路径在追加分页时保持选中。
          if (!reset) selection.value = new Set(selection.value);
          break;
        } catch (cause) {
          // ACT: 上次停留的文件夹被外部删除/改名时，自动退回根目录，而不是把错误横幅一直挂着。
          if (attempt === 0 && reset && request === listRequest && token === directoryToken && state.value.path && isMissingAssetPath(cause)) {
            update({ path: "" });
            continue;
          }
          // 只对首次加载的瞬时失败重试一次；分页与用户主动操作不做静默重试。
          if (attempt === 0 && reset && request === listRequest && token === directoryToken && isTransientAssetFailure(cause)) {
            await delay(300);
            if (request !== listRequest || token !== directoryToken) return;
            continue;
          }
          if (request === listRequest) error.value = toAssetError(cause).message;
          break;
        }
      }
    } finally {
      if (request === listRequest) {
        loading.value = false;
        loadingMore.value = false;
        syncing.value = false;
      }
    }
  }

  function loadMore() {
    if (!loading.value && !loadingMore.value && nextCursor.value) void loadList(false);
  }

  async function refresh() {
    if (rootsFailed.value) await loadRoots();
    refreshTree();
    await loadList(true);
  }

  function refreshTree() {
    treeVersion.value++;
  }

  function navigate(path: string) {
    const target = normalizeAssetPath(path);
    if (target === state.value.path) return;
    update({ path: target });
    query.value = "";
    clearSelection();
    void loadList(true);
  }

  function goUp() {
    if (!state.value.path) return;
    navigate(parentAssetPath(state.value.path));
  }

  function submitSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    void loadList(true);
  }

  function clearSearch() {
    if (!query.value) return;
    query.value = "";
    void loadList(true);
  }

  function isSelected(path: string) {
    return selection.value.has(path);
  }

  function selectEntry(entry: AssetEntry, mode: SelectionMode = "single") {
    const next = new Set(selection.value);
    if (mode === "toggle") {
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      lastSelectedPath.value = entry.path;
    } else if (mode === "range" && lastSelectedPath.value) {
      const from = entries.value.findIndex(item => item.path === lastSelectedPath.value);
      const to = entries.value.findIndex(item => item.path === entry.path);
      if (from >= 0 && to >= 0) {
        next.clear();
        const [start, end] = from < to ? [from, to] : [to, from];
        for (let index = start; index <= end; index++) next.add(entries.value[index]!.path);
      } else {
        next.clear();
        next.add(entry.path);
      }
    } else {
      next.clear();
      next.add(entry.path);
      lastSelectedPath.value = entry.path;
    }
    selection.value = next;
  }

  function selectOnly(entry: AssetEntry) {
    selection.value = new Set([entry.path]);
    lastSelectedPath.value = entry.path;
  }

  function selectAll() {
    selection.value = new Set(entries.value.map(entry => entry.path));
  }

  function clearSelection() {
    selection.value = new Set();
    lastSelectedPath.value = undefined;
  }

  async function revealEntry(entry: AssetEntry) {
    if (entry.type === "directory") {
      navigate(entry.path);
      return;
    }
    if (!query.value.trim()) {
      const parent = parentAssetPath(entry.path);
      if (parent !== state.value.path) {
        update({ path: parent });
        await loadList(true);
      }
    }
    selectOnly(entry);
  }

  function relocatePath(oldPath: string, newPath: string) {
    if (isSameOrDescendant(state.value.path, oldPath)) {
      update({ path: newPath + state.value.path.slice(oldPath.length) });
    }
    const prefix = `${state.value.library}:${oldPath}`;
    const expanded = state.value.expanded.map(key => key === prefix || key.startsWith(`${prefix}/`)
      ? `${state.value.library}:${newPath}${key.slice(prefix.length)}`
      : key);
    store.setExpanded(expanded, directoryPath.value || undefined);
    clearSelection();
    void loadList(true);
    refreshTree();
  }

  function setExpanded(keys: string[]) {
    store.setExpanded(keys, directoryPath.value || undefined);
  }

  function resetForDirectory() {
    listRequest++;
    entries.value = [];
    total.value = 0;
    nextCursor.value = undefined;
    query.value = "";
    clearSelection();
    roots.value = undefined;
    void loadRoots();
    void loadList(true);
    refreshTree();
  }

  watch(directoryPath, resetForDirectory, { immediate: false });
  // 订阅参数带库与目录：切库/切项目或面板不可见时要重连或断开。
  watch([() => state.value.library, directoryPath, changesEnabled], ([, , enabled], previous) => {
    stopChanges();
    if (!enabled) return;
    // 从隐藏状态恢复：断开期间的事件不会补发，先静默刷新一次。
    if (previous?.[2] === false) void loadList(true, { silent: true });
    void connectChanges();
  });
  watch(query, value => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { void loadList(true); }, 280);
  });
  onBeforeUnmount(() => {
    disposed = true;
    listRequest++;
    if (searchTimer) clearTimeout(searchTimer);
    stopChanges();
  });

  async function init() {
    await loadRoots();
    await loadList(true);
    void connectChanges();
  }

  return {
    store,
    state,
    directoryPath,
    roots,
    entries,
    total,
    truncated,
    nextCursor,
    loading,
    loadingMore,
    syncing,
    missingEntries,
    missingTotal,
    forgetMissing,
    error,
    displayError,
    query,
    library,
    view,
    sort,
    order,
    currentPath,
    currentKey,
    expandedKeys,
    selectedEntries,
    selection,
    projectRoot,
    projectFallback,
    projectFallbackPath,
    projectAvailable,
    indexRebuilding,
    emptyKind,
    isSearching,
    searchScopeLabel,
    selector,
    init,
    loadList,
    loadMore,
    refresh,
    refreshTree,
    treeVersion,
    navigate,
    goUp,
    setLibrary,
    setView,
    setSort,
    toggleOrder,
    submitSearch,
    clearSearch,
    isSelected,
    selectEntry,
    selectOnly,
    selectAll,
    clearSelection,
    revealEntry,
    relocatePath,
    setExpanded,
  };
}

export type AssetLibraryContext = ReturnType<typeof useAssetLibrary>;
