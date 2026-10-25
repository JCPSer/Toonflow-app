<template>
  <div class="assetDestinationTree">
    <div class="destinationToolbar">
      <span class="destinationLabel">{{ translate("目标文件夹") }}</span>
      <el-button v-if="allowCreate" text size="small" :icon="IconFolderPlus" :disabled="creating" @click="createFolder">{{ translate("新建文件夹") }}</el-button>
    </div>
    <el-tree
      ref="treeRef"
      :key="treeVersion"
      class="destinationTree"
      node-key="id"
      lazy
      :load="loadNode"
      :props="treeProps"
      :default-expanded-keys="expandedDefaults"
      :current-node-key="currentKey"
      highlight-current
      :expand-on-click-node="false"
      empty-text=""
      @node-click="onNodeClick">
      <template #default="{ data, node }">
        <span class="destinationRow" :class="{ disabled: data.disabled }" :title="data.path">
          <component :is="node.expanded && !node.isLeaf ? IconFolderOpen : IconFolder" :size="16" aria-hidden="true" />
          <span class="destinationName">{{ data.name }}</span>
        </span>
      </template>
    </el-tree>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { ElMessageBox, type LoadFunction, type TreeInstance, type TreeNodeData } from "element-plus";
import { IconFolder, IconFolderOpen, IconFolderPlus } from "@tabler/icons-vue";
import { createDirectory, getTree, toAssetError } from "../api";
import type { AssetLibraryKind } from "../types";
import { joinAssetPath } from "../types";

type DestinationNode = { id: string; path: string; name: string; type: "directory"; disabled?: boolean };

const props = withDefaults(defineProps<{
  library: AssetLibraryKind;
  directory?: string;
  modelValue: string;
  rootLabel?: string;
  allowCreate?: boolean;
  disabledPaths?: (path: string) => boolean;
}>(), { rootLabel: "素材库根目录", allowCreate: false });
const emit = defineEmits<{ "update:modelValue": [path: string]; error: [message: string] }>();

const treeRef = ref<TreeInstance>();
const treeVersion = ref(0);
const creating = ref(false);
const rootName = () => props.rootLabel;
const rootId = ":root";
const treeProps = {
  label: "name",
  disabled: "disabled",
  isLeaf: (data: TreeNodeData) => (data as DestinationNode).type !== "directory",
};

function rootNode(): DestinationNode {
  return { id: rootId, path: "", name: rootName(), type: "directory" };
}

function expandedAncestors(path: string) {
  const parts = path.split("/").filter(Boolean);
  return [rootId, ...parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/"))];
}

const expandedDefaults = ref<string[]>(expandedAncestors(props.modelValue));
const currentKey = computed(() => props.modelValue || rootId);

function nodeFrom(path: string, name: string): DestinationNode {
  return { id: path, path, name, type: "directory", disabled: props.disabledPaths?.(path) === true };
}

const loadNode: LoadFunction = async (node, resolve) => {
  if (node.level === 0) {
    resolve([rootNode() as unknown as TreeNodeData]);
    return;
  }
  const data = node.data as DestinationNode;
  try {
    const result = await getTree({ library: props.library, directory: props.directory }, data.path);
    resolve(result.items.filter(entry => entry.type === "directory").map(entry => nodeFrom(entry.path, entry.name)) as unknown as TreeNodeData[]);
  } catch (cause) {
    emit("error", toAssetError(cause).message);
    resolve([]);
  }
};

function onNodeClick(data: DestinationNode) {
  if (data.disabled) return;
  emit("update:modelValue", data.path);
}

function syncCurrent() {
  void nextTick(() => treeRef.value?.setCurrentKey(currentKey.value));
}

async function createFolder() {
  if (creating.value) return;
  try {
    const { value } = await ElMessageBox.prompt(translate("在“{path}”中新建文件夹", { path: props.modelValue || rootName() }), translate("新建文件夹"), {
      inputValue: translate("新建文件夹"),
      inputValidator: value => !!value?.trim() && !/[\\/]/.test(value) || translate("请输入有效名称，不能包含斜杠"),
      confirmButtonText: translate("创建"),
      cancelButtonText: translate("取消"),
    });
    const name = value.trim();
    if (!name) return;
    creating.value = true;
    const created = await createDirectory({ library: props.library, directory: props.directory }, joinAssetPath(props.modelValue, name));
    treeVersion.value++;
    emit("update:modelValue", created.path);
    expandedDefaults.value = [...new Set([rootId, props.modelValue, created.path])];
    syncCurrent();
  } catch (cause) {
    if (cause === "cancel" || cause === "close") return;
    emit("error", toAssetError(cause).message);
  } finally {
    creating.value = false;
  }
}

watch(() => props.modelValue, value => {
  expandedDefaults.value = [...new Set([...expandedDefaults.value, ...expandedAncestors(value)])];
  syncCurrent();
});
watch(() => props.library, () => { treeVersion.value++; expandedDefaults.value = expandedAncestors(props.modelValue); syncCurrent(); });
watch(() => props.directory, () => { treeVersion.value++; syncCurrent(); });
syncCurrent();
</script>

<style scoped lang="scss">
.assetDestinationTree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-border-radius-base);

  .destinationToolbar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    padding: 2px 6px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    font-size: 12px;

    .destinationLabel { color: var(--el-text-color-secondary); }
  }

  .destinationTree {
    flex: 1;
    min-height: 160px;
    max-height: 280px;
    overflow: auto;
    padding: 4px;

    :deep(.el-tree-node__content) {
      height: 30px;
      border-radius: var(--el-border-radius-base);
    }

    .destinationRow {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding-right: 8px;
      font-size: 12px;

      &.disabled { opacity: 0.45; }
      svg { flex-shrink: 0; color: var(--el-text-color-secondary); }
      .destinationName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    }
  }
}
</style>
