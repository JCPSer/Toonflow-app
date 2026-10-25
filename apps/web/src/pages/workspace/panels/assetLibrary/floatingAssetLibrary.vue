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
    :left="panel.floating.left"
    :top="panel.floating.top"
    drag-selector=".assetPanelHeader"
    aria-label="素材库"
    @resize="emit('resize', $event)"
    @layout="persistLayout">
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
      <AssetLibraryContent ref="contentRef" :directory="directory" :active="visible" />
    </div>
  </floatingPanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import { IconAppWindowBottomRight, IconFolders, IconLayoutSidebarLeftExpand, IconX } from "@tabler/icons-vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { useAssetLibraryStore } from "@/stores/assetLibrary";
import { useSessionStateStore } from "@/stores/sessionState";
import floatingPanel from "@/pages/workspace/components/floatingPanel.vue";
import AssetLibraryContent from "./index.vue";

type FloatingPanelLayout = { left: number | null; top: number | null; width: number; height: number };

const emit = defineEmits<{ resize: [width: number] }>();
const workspace = useWorkspaceStore();
const store = useAssetLibraryStore();
const sessionState = useSessionStateStore();
const contentRef = ref<InstanceType<typeof AssetLibraryContent>>();
const directory = computed(() => workspace.project?.directory);
const state = computed(() => store.state);
// ACT: 布局（宽高/停靠/浮层位置）全机一份；素材库浏览态仍按项目保留在 assetLibrary store。
const panel = computed(() => sessionState.state.panels.asset);

// 迁移只需在本页生命周期内执行一次；成功写入服务端后 migratedAt 会阻止其它客户端重复迁移。
let layoutMigrated = false;
function migrateLegacyLayout() {
  if (layoutMigrated) return;
  layoutMigrated = true;
  // 服务端已有 panels.asset 或已迁移过时，以全局布局为准；init 失败时来源未知，禁止迁移。
  if (sessionState.initFailed || sessionState.hasSource("panels.asset") || panel.value.migratedAt) return;
  const key = (directory.value ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  const legacy = (key ? store.stateByDirectory[key] : undefined)
    ?? Object.values(store.stateByDirectory).at(-1)
    ?? store.state;
  sessionState.set("panels.asset.width", legacy.width || 360);
  sessionState.set("panels.asset.height", legacy.height || 0);
  sessionState.set("panels.asset.docked", legacy.docked !== false);
  sessionState.set("panels.asset.migratedAt", Date.now());
}
migrateLegacyLayout();

const visible = computed({ get: () => store.visible, set: value => { store.visible = value; } });
const docked = computed({
  get: () => panel.value.docked,
  set: value => {
    sessionState.set("panels.asset.docked", value);
    if (contentRef.value) contentRef.value.focusRoot();
  },
});
// 拖拽期间用本地 ref 保持跟手，只有结束时才写入会话状态。
const width = ref(panel.value.width || 360);
const height = ref(panel.value.height || 0);

watch(() => store.pendingSave, request => {
  if (!request) return;
  contentRef.value?.openSave(request.label, request.outputs);
  store.consumeSave(request.id);
}, { immediate: true });

function persistLayout(layout: FloatingPanelLayout) {
  width.value = layout.width;
  height.value = layout.height;
  sessionState.set("panels.asset.width", layout.width);
  // 0 表示自动高度（服务端对 0 保持原值），必须一并写入，双击复位才能持久化。
  sessionState.set("panels.asset.height", layout.height);
  // ACT: 停靠时只保存宽高；浮层坐标保持原值（可能是 null），不能把本地坐标写成“拖动过”。
  if (docked.value) return;
  if (typeof layout.left === "number" && Number.isFinite(layout.left)) {
    sessionState.set("panels.asset.floating.left", layout.left);
  }
  if (typeof layout.top === "number" && Number.isFinite(layout.top)) {
    sessionState.set("panels.asset.floating.top", layout.top);
  }
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
