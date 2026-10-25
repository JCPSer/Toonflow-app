import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import { useWorkspaceStore } from "./workspace";
import { useSessionStateStore } from "./sessionState";

export type AssetLibraryKind = "global" | "project";
export type AssetView = "tree" | "folder";
export type AssetSortField = "name" | "mtime" | "size" | "type";
export type AssetSortOrder = "asc" | "desc";

export type AssetLibraryState = {
  library: AssetLibraryKind;
  view: AssetView;
  path: string;
  sort: AssetSortField;
  order: AssetSortOrder;
  docked: boolean;
  width: number;
  height: number;
  expanded: string[];
};

export type AssetSaveOutput = { label: string; output: NodeOutput };
export type AssetSaveRequest = { id: string; label: string; outputs: AssetSaveOutput[] };

// ACT: 未打开项目（如首页素材库）时没有项目库可请求，默认落在全局库，避免先发一次必 400 的项目库请求。
export const defaultAssetLibraryState = (directory?: string): AssetLibraryState => ({
  library: directory ? "project" : "global",
  view: "tree",
  path: "",
  sort: "name",
  order: "asc",
  docked: true,
  width: 360,
  height: 0,
  expanded: ["root:project", "root:global"],
});

function directoryKey(directory?: string) {
  return (directory ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
}

export const useAssetLibraryStore = defineStore("assetLibrary", () => {
  const workspace = useWorkspaceStore();
  const sessionState = useSessionStateStore();
  // ACT: visible 仍以本 store 为唯一运行态（画布控制条、requestSave 直接用），
  // 只单向镜像到会话状态；hydrate 后反向灌一次，绝不双源。
  const visible = ref(false);
  if (sessionState.hydrated) visible.value = sessionState.state.panels.asset.visible;
  else watch(() => sessionState.hydrated, ready => {
    if (ready) visible.value = sessionState.state.panels.asset.visible;
  }, { once: true });
  watch(visible, value => sessionState.set("panels.asset.visible", value));
  const pendingSave = ref<AssetSaveRequest>();
  // 按项目目录分桶，切换项目时各自保留库、路径、排序与面板尺寸。
  const stateByDirectory = ref<Record<string, AssetLibraryState>>({});
  const fallback = reactive<AssetLibraryState>(defaultAssetLibraryState());
  const directory = computed(() => workspace.project?.directory ?? "");

  watch(directory, current => {
    const key = directoryKey(current);
    if (!key || stateByDirectory.value[key]) return;
    stateByDirectory.value[key] = defaultAssetLibraryState(current);
  }, { immediate: true, flush: "sync" });

  const state = computed<AssetLibraryState>(() => {
    const key = directoryKey(directory.value);
    return (key ? stateByDirectory.value[key] : undefined) ?? fallback;
  });

  function stateFor(directoryPath?: string): AssetLibraryState {
    const key = directoryKey(directoryPath ?? directory.value);
    if (!key) return fallback;
    const existing = stateByDirectory.value[key];
    if (existing) return existing;
    const created = defaultAssetLibraryState(key);
    stateByDirectory.value[key] = created;
    return created;
  }

  function update(patch: Partial<AssetLibraryState>, directoryPath?: string) {
    Object.assign(stateFor(directoryPath), patch);
  }

  function setExpanded(expanded: string[], directoryPath?: string) {
    stateFor(directoryPath).expanded = [...new Set(expanded)];
  }

  function requestSave(label: string, outputs: AssetSaveOutput[]) {
    pendingSave.value = { id: crypto.randomUUID(), label, outputs };
    visible.value = true;
  }

  function consumeSave(id: string) {
    if (pendingSave.value?.id === id) pendingSave.value = undefined;
  }

  return {
    visible,
    state,
    stateByDirectory,
    pendingSave,
    stateFor,
    update,
    setExpanded,
    requestSave,
    consumeSave,
  };
}, {
  persist: {
    key: "toonflow.assetLibrary",
    pick: ["stateByDirectory"],
  },
});
