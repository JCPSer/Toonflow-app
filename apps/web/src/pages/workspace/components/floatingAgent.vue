<template>
  <floatingPanel
    id="agentPanel"
    v-bind="$attrs"
    v-model:visible="visible"
    v-model:docked="docked"
    v-model:width="preferredWidth"
    v-model:height="preferredHeight"
    class="floatingAgent"
    dock-side="right"
    :default-width="420"
    :default-height="0"
    :min-width="320"
    :min-height="240"
    :max-dock-ratio="0.45"
    :left="panel.floating.left"
    :top="panel.floating.top"
    :resize-edges="agentResizeEdges"
    drag-selector=".agentMenu"
    exclude-selector=".conversationTitle"
    :reset-on-double-click="false"
    :reset-on-escape="false"
    aria-label="AI 对话"
    @resize="emit('resize', $event)"
    @layout="persistLayout">
    <agent v-model="visible">
      <template #menuActions>
        <el-button
          text
          circle
          :aria-label="docked ? '切换为悬浮' : '停靠到右侧'"
          :title="docked ? '切换为悬浮' : '停靠到右侧'"
          @click="docked = !docked">
          <icon-app-window-bottom-right v-if="docked" :size="17" aria-hidden="true" />
          <icon-layout-sidebar-right v-else :size="17" aria-hidden="true" />
        </el-button>
      </template>
    </agent>
  </floatingPanel>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IconLayoutSidebarRight, IconAppWindowBottomRight } from "@tabler/icons-vue";
import agent from "@/components/agent/index.vue";
import { useSessionStateStore } from "@/stores/sessionState";
import floatingPanel from "./floatingPanel.vue";

type FloatingPanelLayout = { left: number; top: number; width: number; height: number };

const emit = defineEmits<{ resize: [width: number] }>();
const sessionState = useSessionStateStore();
const panel = computed(() => sessionState.state.panels.agent);

// ACT: Agent 面板的显隐/停靠/宽高/浮层位置全部以会话状态为唯一来源，默认可见。
const visible = computed({
  get: () => panel.value.visible,
  set: value => sessionState.set("panels.agent.visible", value),
});
const docked = computed({
  get: () => panel.value.docked,
  set: value => sessionState.set("panels.agent.docked", value),
});
// 拖拽期间用本地 ref 保持跟手，只有结束时才写入会话状态。
const preferredWidth = ref(panel.value.width || 420);
const preferredHeight = ref(panel.value.height || 0);
const agentResizeEdges = ["w", "e", "s"] as ("w" | "e" | "s")[];

function persistLayout(layout: FloatingPanelLayout) {
  preferredWidth.value = layout.width;
  preferredHeight.value = layout.height;
  sessionState.set("panels.agent.width", layout.width);
  // 0 表示自动高度（服务端对 0 保持原值），必须一并写入。
  sessionState.set("panels.agent.height", layout.height);
  sessionState.set("panels.agent.floating.left", layout.left);
  sessionState.set("panels.agent.floating.top", layout.top);
}
</script>

<style scoped lang="scss">
.floatingAgent {
  :deep(.agent) {
    border-radius: inherit;
  }
  &:not(.docked) :deep(.agentMenu) {
    cursor: grab;
    touch-action: none;
  }

  &.dragging {
    :deep(.agentMenu) {
      cursor: grabbing;
    }
  }
}
</style>
