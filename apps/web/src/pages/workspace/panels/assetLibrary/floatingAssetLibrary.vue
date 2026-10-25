<template>
  <floatingPanel
    v-bind="$attrs"
    id="assetLibraryPanel"
    v-model:visible="visible"
    v-model:docked="docked"
    v-model:width="width"
    v-model:height="height"
    class="floatingAssetLibrary"
    dock-side="left"
    :default-width="360"
    :default-height="0"
    :min-width="320"
    :min-height="240"
    :max-dock-ratio="0.45"
    :persist-key="directory || 'home'"
    drag-selector=".assetPanelHeader"
    aria-label="素材库"
    @resize="emit('resize', $event)"
    @change="persistSize">
    <div class="assetPanelShell">
      <header class="assetPanelHeader">
        <span class="panelTitle"><icon-folders :size="16" aria-hidden="true" />{{ translate("素材库") }}</span>
        <span class="panelLibraryBadge">{{ state.library === "project" ? translate("本项目") : translate("全局") }}</span>
        <span class="panelDragSpace" />
        <el-button
          text
          circle
          size="small"
          :aria-label="docked ? translate('切换为浮层') : translate('停靠到左侧')"
          :title="docked ? translate('切换为浮层') : translate('停靠到左侧')"
          @click="docked = !docked">
          <icon-app-window-bottom-right v-if="docked" :size="16" aria-hidden="true" />
          <icon-layout-sidebar-left-expand v-else :size="16" aria-hidden="true" />
        </el-button>
        <el-button
          text
          circle
          size="small"
          :aria-label="translate('关闭素材库')"
          :title="translate('关闭素材库')"
          @click="visible = false">
          <icon-x :size="16" aria-hidden="true" />
        </el-button>
      </header>
      <AssetLibraryContent ref="contentRef" :directory="directory" />
    </div>
  </floatingPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { IconAppWindowBottomRight, IconFolders, IconLayoutSidebarLeftExpand, IconX } from "@tabler/icons-vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useAssetLibraryStore } from "@/stores/assetLibrary";
import floatingPanel from "@/pages/workspace/components/floatingPanel.vue";
import AssetLibraryContent from "./index.vue";

const emit = defineEmits<{ resize: [width: number] }>();
const workspace = useWorkspaceStore();
const store = useAssetLibraryStore();
const contentRef = ref<InstanceType<typeof AssetLibraryContent>>();
const directory = computed(() => workspace.project?.directory);
const state = computed(() => store.state);

const visible = computed({ get: () => store.visible, set: value => { store.visible = value; } });
const docked = computed({
  get: () => state.value.docked,
  set: value => {
    store.update({ docked: value });
    if (contentRef.value) contentRef.value.focusRoot();
  },
});
const width = ref(state.value.width || 360);
const height = ref(state.value.height || 0);

watch(() => [state.value.width, state.value.height] as const, ([nextWidth, nextHeight]) => {
  width.value = nextWidth || 360;
  height.value = nextHeight || 0;
});
watch(directory, () => {
  width.value = state.value.width || 360;
  height.value = state.value.height || 0;
});
watch(() => store.pendingSave, request => {
  if (!request) return;
  contentRef.value?.openSave(request.label, request.outputs);
  store.consumeSave(request.id);
}, { immediate: true });

function persistSize() {
  store.update({ width: width.value, height: height.value });
}

defineExpose({ content: contentRef });
</script>

<style scoped lang="scss">
.floatingAssetLibrary {
  .assetPanelShell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-radius: inherit;
  }

  .assetPanelHeader {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 6px 0 10px;
    border-bottom: 1px solid var(--el-border-color-lighter);
    touch-action: none;
    user-select: none;

    .panelTitle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;

      svg { color: var(--el-text-color-secondary); }
    }

    .panelLibraryBadge {
      flex-shrink: 0;
      padding: 0 6px;
      border-radius: var(--el-border-radius-round);
      color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
      font-size: 10px;
      line-height: 16px;
    }

    .panelDragSpace { flex: 1; align-self: stretch; cursor: grab; }

    .el-button {
      width: 24px;
      height: 24px;
      margin: 0;
      padding: 0;
    }
  }

  &:not(.docked) .assetPanelHeader { cursor: grab; }
  &.dragging .assetPanelHeader { cursor: grabbing; }
}
</style>
