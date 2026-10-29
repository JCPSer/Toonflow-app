<template>
  <div class="workspaceMenu">
    <el-card shadow="never" :bodyStyle="{ padding: '2px 4px' }">
      <div class="menuContent">
        <el-button class="toolButton" text aria-label="退出项目" title="退出项目" @click="requestExitProject">
          <icon-logout :size="18" aria-hidden="true" />
        </el-button>
        <el-button class="toolButton" text :aria-label="hasDesktopUpdate ? '设置，有新版本可用' : '设置'" title="设置" @click="emit('openSettings')">
          <el-badge isDot :hidden="!hasDesktopUpdate">
            <icon-settings :size="18" aria-hidden="true" />
          </el-badge>
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { IconLogout, IconSettings } from "@tabler/icons-vue";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import { requestExitProject } from "../exitProject";

const emit = defineEmits<{ openSettings: [] }>();
</script>

<style scoped lang="scss">
.workspaceMenu {
  .menuContent {
    display: flex;
    align-items: center;
    gap: 2px;

    .toolButton {
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
    }
  }
}
</style>
