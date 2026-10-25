import { ref } from "vue";
import axios from "axios";
import { ElMessage, ElMessageBox } from "element-plus";
import { translate } from "@toonflow/i18n/vue";
import saveFile from "@/lib/saveFile";
import {
  assetReadUrl, createDirectory, getTrash, getUsages, getUsagesBatch, moveEntries, patchMeta, purgeTrash, removeEntries,
  renameEntry, restoreTrash, toAssetError,
} from "./api";
import type { AssetLibraryContext } from "./useAssetLibrary";
import type { AssetDragPayload, AssetEntry, AssetTrashItem, AssetUsage, AssetUsageCheck, AssetUsageCheckState } from "./types";
import {
  batchErrorChecked, batchErrorMessage, batchErrorUsages, isPreviewable, isSameOrDescendant, joinAssetPath, parentAssetPath,
} from "./types";

export function useAssetActions(lib: AssetLibraryContext) {
  const previewVisible = ref(false);
  const previewEntry = ref<AssetEntry>();

  const moveVisible = ref(false);
  const moveTargets = ref<AssetEntry[]>([]);
  const moveInitialTarget = ref("");

  const metaVisible = ref(false);
  const metaEntry = ref<AssetEntry>();
  const metaSaving = ref(false);

  const referenceVisible = ref(false);
  const referenceEntries = ref<AssetEntry[]>([]);
  const referenceUsages = ref<AssetUsage[]>([]);
  // 引用确认后仍待普通删除的项（不含引用），避免一次 force 删掉全部选中项。
  const referenceRemaining = ref<AssetEntry[]>([]);

  const trashVisible = ref(false);
  const trashItems = ref<AssetTrashItem[]>([]);
  const trashUsage = ref(0);
  const trashLoading = ref(false);

  function showError(cause: unknown) {
    if (cause === "cancel" || cause === "close") return;
    ElMessage.error(toAssetError(cause).message);
  }

  function showMessage(message: string) {
    ElMessage.error(message);
  }

  function openEntry(entry: AssetEntry) {
    if (entry.type === "directory") {
      lib.navigate(entry.path);
      return;
    }
    if (!isPreviewable(entry)) return;
    previewEntry.value = entry;
    previewVisible.value = true;
  }

  async function createFolder(parentPath = lib.currentPath.value) {
    const location = parentPath || (lib.library.value === "project" ? translate("本项目素材库根目录") : translate("全局素材库根目录"));
    try {
      const { value } = await ElMessageBox.prompt(translate("在“{path}”中新建文件夹", { path: location }), translate("新建文件夹"), {
        inputValue: translate("新建文件夹"),
        inputValidator: value => !!value?.trim() && !/[\\/]/.test(value) && ![".", ".."].includes(value.trim()) || translate("请输入有效名称，不能包含斜杠"),
        confirmButtonText: translate("创建"),
        cancelButtonText: translate("取消"),
      });
      const name = value.trim();
      if (!name) return;
      await createDirectory(lib.selector(), joinAssetPath(parentPath, name));
      ElMessage.success(translate("已创建文件夹"));
      await lib.refresh();
      if (parentPath === lib.currentPath.value && lib.view.value === "folder") lib.navigate(joinAssetPath(parentPath, name));
    } catch (cause) {
      showError(cause);
    }
  }

  async function renameEntryAction(entry: AssetEntry) {
    if (!entry.path) return;
    try {
      const { value } = await ElMessageBox.prompt(translate("名称"), translate("重命名"), {
        inputValue: entry.name,
        inputValidator: value => !!value?.trim() && !/[\\/]/.test(value) && ![".", ".."].includes(value.trim()) || translate("请输入有效名称，不能包含斜杠"),
        confirmButtonText: translate("保存"),
        cancelButtonText: translate("取消"),
      });
      const name = value.trim();
      if (!name || name === entry.name) return;
      const result = await renameEntry(lib.selector(), entry.path, name);
      ElMessage.success(translate("已重命名"));
      if (entry.type === "directory") lib.relocatePath(entry.path, result.path);
      else await lib.refresh();
    } catch (cause) {
      showError(cause);
    }
  }

  function requestMove(targets: AssetEntry[]) {
    if (!targets.length) return;
    moveTargets.value = targets;
    moveInitialTarget.value = lib.currentPath.value;
    moveVisible.value = true;
  }

  async function confirmMove(target: string) {
    moveVisible.value = false;
    const targets = moveTargets.value;
    if (!targets.length) return;
    try {
      const result = await moveEntries(lib.selector(), targets.map(entry => entry.path), target);
      const failures = result.items.filter(item => !item.ok);
      const successes = result.items.filter(item => item.ok);
      if (successes.length) ElMessage.success(translate("已移动 {count} 项", { count: successes.length }));
      if (failures.length) {
        ElMessage.error(translate("{count} 项移动失败：{detail}", {
          count: failures.length,
          detail: failures.slice(0, 3).map(item => batchErrorMessage(item.error) || item.path).join("；"),
        }));
      }
      // 若当前目录本身被移动，跟随到新位置；否则刷新当前目录与树。
      const movedAncestor = targets
        .map((entry, index) => ({ entry, item: result.items[index] }))
        .find(({ entry, item }) => item?.ok && entry.type === "directory" && isSameOrDescendant(lib.currentPath.value, entry.path));
      lib.clearSelection();
      const movedTarget = movedAncestor?.item?.target ?? movedAncestor?.item?.path;
      if (movedAncestor && movedTarget) lib.navigate(movedTarget + lib.currentPath.value.slice(movedAncestor.entry.path.length));
      else await lib.refresh();
    } catch (cause) {
      showError(cause);
    }
  }

  type UsageCheckEntry = { entry: AssetEntry; usages: AssetUsage[]; checked: AssetUsageCheckState };

  function incompleteChecked(checks: UsageCheckEntry[]) {
    return checks.some(item => item.checked === "partial" || item.checked === "unavailable");
  }

  /** 单条走 /usage；批量优先一次 /usage/batch，旧服务端 404 时回退逐项。 */
  async function checkUsages(targets: AssetEntry[]): Promise<UsageCheckEntry[]> {
    if (!targets.length) return [];
    if (targets.length === 1) {
      const result = await getUsages(lib.selector(), targets[0]!.path);
      return [{ entry: targets[0]!, usages: result.usages, checked: result.checked ?? "complete" }];
    }
    try {
      const result = await getUsagesBatch(lib.selector(), targets.map(entry => entry.path));
      const byPath = new Map<string, AssetUsageCheck>(result.items.map(item => [item.path, item]));
      return targets.map(entry => {
        const found = byPath.get(entry.path);
        return { entry, usages: found?.usages ?? [], checked: found?.checked ?? "complete" };
      });
    } catch (error) {
      const info = toAssetError(error);
      if (info.status !== 404 && info.status !== 405 && info.status !== 501) throw error;
      return Promise.all(targets.map(async entry => {
        const result = await getUsages(lib.selector(), entry.path);
        return { entry, usages: result.usages, checked: result.checked ?? "complete" };
      }));
    }
  }

  async function confirmIncompleteCheck() {
    await ElMessageBox.confirm(
      translate("引用检查未完成，可能仍有画布或会话引用这些素材。是否仍然删除？"),
      translate("引用检查未完成"),
      { type: "warning", confirmButtonText: translate("仍然删除"), cancelButtonText: translate("取消"), closeOnClickModal: false },
    );
  }

  async function performDelete(targets: AssetEntry[], options: { force?: boolean } = {}) {
    const result = await removeEntries(lib.selector(), targets.map(entry => entry.path), options.force ? { force: true } : {});
    const failures = result.items.filter(item => !item.ok);
    const successes = result.items.filter(item => item.ok);
    if (successes.length) ElMessage.success(translate("已移入回收站 {count} 项", { count: successes.length }));
    referenceVisible.value = false;
    const deletedAncestor = targets.find(entry => isSameOrDescendant(lib.currentPath.value, entry.path));
    lib.clearSelection();
    if (successes.length) {
      if (deletedAncestor) lib.navigate(parentAssetPath(deletedAncestor.path));
      else await lib.refresh();
    } else {
      await lib.refresh();
    }
    if (!failures.length) return;

    const failedPaths = new Set(failures.map(item => item.path));
    const failedEntries = targets.filter(entry => failedPaths.has(entry.path));
    const embedded = failures.flatMap(item => {
      const entry = failedEntries.find(candidate => candidate.path === item.path);
      return entry ? [{ entry, usages: batchErrorUsages(item.error), checked: batchErrorChecked(item.error) }] : [];
    });
    // 批量响应若带引用/checked 就直接复用，否则只对失败项补查一次，避免 N 次全量扫描。
    const needProbe = embedded.some(item => item.usages.length || item.checked !== undefined);
    const checks: UsageCheckEntry[] = needProbe
      ? embedded.map(item => ({ entry: item.entry, usages: item.usages, checked: item.checked ?? "complete" }))
      : await checkUsages(failedEntries);
    if (incompleteChecked(checks)) {
      await confirmIncompleteCheck();
      await performDelete(checks.map(item => item.entry), { force: true });
      return;
    }
    // 强制删除只针对“失败且被引用”的项，绝不扩大到本次全部选中项。
    const referenced = checks.filter(item => item.usages.length > 0);
    if (referenced.length) {
      referenceEntries.value = referenced.map(item => item.entry);
      referenceUsages.value = referenced.flatMap(item => item.usages);
      referenceRemaining.value = [];
      referenceVisible.value = true;
      return;
    }
    ElMessage.error(translate("{count} 项删除失败：{detail}", {
      count: failures.length,
      detail: failures.slice(0, 3).map(item => batchErrorMessage(item.error) || item.path).join("；"),
    }));
  }

  async function deleteEntries(targets: AssetEntry[], force = false) {
    if (!targets.length) return;
    try {
      if (!force) {
        const label = targets.length === 1 ? `“${targets[0]!.name}”` : translate("这 {count} 项", { count: targets.length });
        await ElMessageBox.confirm(translate("删除{label}？素材会移入回收站，可以恢复。", { label }), translate("删除素材"), {
          type: "warning",
          confirmButtonText: translate("删除"),
          cancelButtonText: translate("取消"),
          closeOnClickModal: false,
        });
        const checks = await checkUsages(targets);
        if (incompleteChecked(checks)) {
          await confirmIncompleteCheck();
          await performDelete(targets, { force: true });
          return;
        }
        const referenced = checks.filter(item => item.usages.length > 0);
        if (referenced.length) {
          referenceEntries.value = referenced.map(item => item.entry);
          referenceRemaining.value = targets.filter(entry => !referenced.some(item => item.entry.path === entry.path));
          referenceUsages.value = referenced.flatMap(item => item.usages);
          referenceVisible.value = true;
          return;
        }
      }
      await performDelete(targets, { force });
    } catch (cause) {
      showError(cause);
    }
  }

  async function confirmForceDelete() {
    const forceTargets = [...referenceEntries.value];
    const remaining = [...referenceRemaining.value];
    referenceVisible.value = false;
    referenceRemaining.value = [];
    try {
      if (forceTargets.length) await performDelete(forceTargets, { force: true });
      if (remaining.length) await performDelete(remaining, {});
    } catch (cause) {
      showError(cause);
    }
  }

  async function toggleFavorite(entry: AssetEntry) {
    try {
      const favorite = !entry.favorite;
      await patchMeta(lib.selector(), entry.path, { favorite });
      entry.favorite = favorite;
      ElMessage.success(favorite ? translate("已收藏") : translate("已取消收藏"));
      lib.treeVersion.value++;
    } catch (cause) {
      showError(cause);
    }
  }

  async function saveMeta(patch: { tags: string[]; note: string; favorite: boolean }) {
    const entry = metaEntry.value;
    if (!entry) return;
    metaSaving.value = true;
    try {
      await patchMeta(lib.selector(), entry.path, patch);
      entry.tags = patch.tags;
      entry.note = patch.note;
      entry.favorite = patch.favorite;
      metaVisible.value = false;
      ElMessage.success(translate("已保存标签与备注"));
      lib.treeVersion.value++;
    } catch (cause) {
      showError(cause);
    } finally {
      metaSaving.value = false;
    }
  }

  async function downloadEntry(entry: AssetEntry) {
    try {
      const url = assetReadUrl(lib.selector(), entry.path);
      if (url.startsWith("data:")) {
        const link = document.createElement("a");
        link.href = url;
        link.download = entry.name;
        link.click();
        return;
      }
      await saveFile(() => axios.get<Blob>(`${url}&download=true`, {
        responseType: "blob",
        headers: { "x-toonflow-workspace": "1" },
      }).then(response => response.data), entry.name);
    } catch (cause) {
      showError(cause);
    }
  }

  async function moveDraggedEntry(payload: AssetDragPayload, targetPath: string) {
    if (!payload.path) return;
    if (payload.library !== lib.library.value) {
      ElMessage.warning(translate("请用收藏复制到另一个素材库，素材库之间不支持直接移动"));
      return;
    }
    if (parentAssetPath(payload.path) === targetPath) return;
    if (payload.type === "directory" && isSameOrDescendant(targetPath, payload.path)) {
      ElMessage.warning(translate("不能把文件夹移动到自身或它的子文件夹"));
      return;
    }
    try {
      const result = await moveEntries(lib.selector(), [payload.path], targetPath);
      const item = result.items[0];
      if (!item?.ok) {
        ElMessage.error(batchErrorMessage(item?.error) || translate("移动失败"));
        return;
      }
      ElMessage.success(translate("已移动"));
      const movedPath = item.target ?? item.path;
      if (payload.type === "directory") lib.relocatePath(payload.path, movedPath);
      else await lib.refresh();
    } catch (cause) {
      showError(cause);
    }
  }

  async function openTrash() {
    trashVisible.value = true;
    lib.clearSelection();
    await loadTrash();
  }

  async function loadTrash() {
    trashLoading.value = true;
    try {
      const result = await getTrash(lib.selector());
      trashItems.value = result.items;
      trashUsage.value = result.usage;
    } catch (cause) {
      showError(cause);
    } finally {
      trashLoading.value = false;
    }
  }

  function exitTrash() {
    trashVisible.value = false;
    void lib.refresh();
  }

  async function restoreTrashItem(item: AssetTrashItem) {
    try {
      await restoreTrash(lib.selector(), item.id);
      ElMessage.success(translate("已恢复 {name}", { name: item.name }));
      await loadTrash();
      await lib.refresh();
    } catch (cause) {
      showError(cause);
    }
  }

  async function purgeTrashItem(item: AssetTrashItem) {
    try {
      await ElMessageBox.confirm(translate("彻底删除“{name}”？此操作不可恢复。", { name: item.name }), translate("彻底删除"), {
        type: "warning",
        confirmButtonText: translate("彻底删除"),
        cancelButtonText: translate("取消"),
      });
      await purgeTrash(lib.selector(), { id: item.id });
      ElMessage.success(translate("已彻底删除"));
      await loadTrash();
    } catch (cause) {
      showError(cause);
    }
  }

  async function emptyTrash() {
    try {
      await ElMessageBox.confirm(translate("清空回收站？所有项目将被彻底删除，无法恢复。"), translate("清空回收站"), {
        type: "warning",
        confirmButtonText: translate("清空"),
        cancelButtonText: translate("取消"),
        closeOnClickModal: false,
      });
      await purgeTrash(lib.selector(), { all: true });
      ElMessage.success(translate("回收站已清空"));
      trashItems.value = [];
      trashUsage.value = 0;
      if (trashVisible.value) await loadTrash();
    } catch (cause) {
      showError(cause);
    }
  }

  return {
    previewVisible, previewEntry,
    moveVisible, moveTargets, moveInitialTarget,
    metaVisible, metaEntry, metaSaving,
    referenceVisible, referenceEntries, referenceUsages,
    trashVisible, trashItems, trashUsage, trashLoading,
    showError, showMessage, openEntry, createFolder, renameEntryAction, requestMove, confirmMove, deleteEntries,
    confirmForceDelete, toggleFavorite, saveMeta, downloadEntry, moveDraggedEntry,
    openTrash, loadTrash, exitTrash, restoreTrashItem, purgeTrashItem, emptyTrash,
    emptyTrashFromToolbar: emptyTrash,
  };
}
