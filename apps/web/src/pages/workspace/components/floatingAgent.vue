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
    :resize-edges="agentResizeEdges"
    drag-selector=".agentMenu"
    exclude-selector=".conversationTitle"
    :reset-on-double-click="false"
    :reset-on-escape="false"
    aria-label="AI 对话"
    @resize="emit('resize', $event)">
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
import { ref } from "vue";
import { IconLayoutSidebarRight, IconAppWindowBottomRight } from "@tabler/icons-vue";
import agent from "@/components/agent/index.vue";
import floatingPanel from "./floatingPanel.vue";

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ resize: [width: number] }>();
const docked = ref(false);
const preferredWidth = ref(420);
const preferredHeight = ref(0);
const agentResizeEdges = ["w", "e", "s"] as ("w" | "e" | "s")[];
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
