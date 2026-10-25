import { computed, onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useAssetLibraryStore, type AssetLibraryState, type AssetSortField, type AssetSortOrder, type AssetView } from "@/stores/assetLibrary";
import { getRoots, listAssets, toAssetError } from "./api";
import type { AssetEntry, AssetLibraryKind, AssetRoots } from "./types";
import { isSameOrDescendant, normalizeAssetPath, parentAssetPath } from "./types";

export type SelectionMode = "single" | "toggle" | "range";

export function useAssetLibrary(directory: MaybeRefOrGetter<string | undefined>) {
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
  const indexRebuilding = ref(false);
  const roots = ref<AssetRoots>();
  const rootsFailed = ref(false);
  const query = ref("");
  const treeVersion = ref(0);
  const selection = ref<Set<string>>(new Set());
  const lastSelectedPath = ref<string>();
  let listRequest = 0;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

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
  const emptyKind = computed<"loading" | "directory" | "search" | "rebuilding" | "project-unavailable">(() => {
    if (loading.value) return "loading";
    if (indexRebuilding.value) return "rebuilding";
    if (isSearching.value) return "search";
    if (state.value.library === "project" && !projectAvailable.value) return "project-unavailable";
    return "directory";
  });
  const searchScopeLabel = computed(() => currentPath.value ? `在 ${currentPath.value} 中搜索` : "搜索全部素材");

  function selector() {
    return { library: state.value.library, directory: directoryPath.value || undefined };
  }

  function update(patch: Partial<AssetLibraryState>) {
    store.update(patch, directoryPath.value || undefined);
  }

  function setLibrary(kind: AssetLibraryKind) {
    if (kind === state.value.library) return;
    if (kind === "project" && (!projectAvailable.value || !projectRoot.value)) return;
    update({ library: kind, path: "" });
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
    rootsFailed.value = false;
    try {
      roots.value = await getRoots(directoryPath.value || undefined);
      rootsFailed.value = false;
      if (!roots.value.project && state.value.library === "project") update({ library: "global", path: "" });
    } catch (cause) {
      // 项目库路径解析失败（例如 library 与 library-assets 都被占用）时保留项目库入口以展示可恢复的空状态。
      rootsFailed.value = true;
      error.value = toAssetError(cause).message;
    }
  }

  async function loadList(reset = false) {
    const request = reset ? ++listRequest : listRequest;
    if (!reset && (!nextCursor.value || loadingMore.value)) return;
    if (reset) {
      loading.value = true;
      entries.value = [];
      selection.value = new Set();
      lastSelectedPath.value = undefined;
      nextCursor.value = undefined;
      total.value = 0;
      truncated.value = false;
    } else {
      loadingMore.value = true;
    }
    error.value = "";
    try {
      const result = await listAssets({
        ...selector(),
        path: state.value.path,
        cursor: reset ? undefined : nextCursor.value,
        limit: 100,
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
      // 已选中的深层路径在追加分页时保持选中。
      if (!reset) selection.value = new Set(selection.value);
    } catch (cause) {
      if (request === listRequest) error.value = toAssetError(cause).message;
    } finally {
      if (request === listRequest) {
        loading.value = false;
        loadingMore.value = false;
      }
    }
  }

  function loadMore() {
    if (!loading.value && !loadingMore.value && nextCursor.value) void loadList(false);
  }

  async function refresh() {
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
  watch(query, value => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { void loadList(true); }, 280);
  });
  onBeforeUnmount(() => {
    listRequest++;
    if (searchTimer) clearTimeout(searchTimer);
  });

  async function init() {
    await loadRoots();
    await loadList(true);
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
    error,
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
