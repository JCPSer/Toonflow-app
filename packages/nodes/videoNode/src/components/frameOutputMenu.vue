<template>
  <el-dropdown trigger="click" placement="bottom-end" :hide-on-click="false" :disabled="disabled" @command="onCommand">
    <el-button
      :icon="IconPlugConnected"
      :loading="busy"
      :disabled="disabled"
      text
      title="输出项"
      aria-label="输出项" />
    <template #dropdown>
      <el-dropdown-menu>
        <!-- ACT: 不用 el-checkbox——它靠隐藏 input 的 change 派发，抽帧失败时 modelValue 没变，
             原生 input 却已被点成 checked，下一次点击会被判成「取消」而变成空操作。 -->
        <el-dropdown-item v-for="item in FRAME_OUTPUTS" :key="item.key" :disabled="busy">
          <button
            type="button"
            class="frameRow"
            role="menuitemcheckbox"
            :aria-checked="enabled[item.key]"
            :disabled="busy"
            @click.stop="emit('toggle', item.key, !enabled[item.key])">
            <el-icon class="frameMark" :class="{ checked: enabled[item.key] }">
              <IconSquareCheckFilled v-if="enabled[item.key]" />
              <IconSquare v-else />
            </el-icon>
            <span class="frameLabel">{{ item.label }}输出</span>
            <img v-if="thumb(item.key)" class="frameThumb" :src="thumb(item.key)!" :alt="`${item.label}预览`" />
            <span v-else class="frameThumbPlaceholder" aria-hidden="true">
              <IconPhoto :size="18" stroke="1.25" />
            </span>
          </button>
        </el-dropdown-item>
        <el-dropdown-item divided :disabled="busy || !hasVideo" command="refresh">
          <el-icon><IconRefresh /></el-icon>重新抽取
        </el-dropdown-item>
        <el-dropdown-item v-if="error" class="frameError" disabled>{{ error }}</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { IconPhoto, IconPlugConnected, IconRefresh, IconSquare, IconSquareCheckFilled } from "@tabler/icons-vue";
import { ElButton, ElDropdown, ElDropdownItem, ElDropdownMenu, ElIcon } from "element-plus";
import { useNodeFiles } from "@toonflow/nodes-scaffold/runtime";
import { FRAME_OUTPUTS, type FrameKey } from "../frameOutputPlan";

const props = defineProps<{
  enabled: Record<FrameKey, boolean>;
  values: Record<FrameKey, string | undefined>;
  busy?: boolean;
  error?: string;
  /** 已有可用视频时才允许「重新抽取」。 */
  hasVideo?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [key: FrameKey, on: boolean];
  refresh: [];
}>();

const { thumbUrl } = useNodeFiles();

/** ACT: 用服务端缩略图而不是整图——下拉里的预览只要看得出是哪一帧。 */
function thumb(key: FrameKey) {
  const url = props.values[key];
  if (!url) return "";
  try {
    return thumbUrl(url, 256);
  } catch {
    return "";
  }
}

function onCommand(command: string | number | object) {
  if (command === "refresh") emit("refresh");
}
</script>

<style scoped lang="scss">
.frameRow {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 240px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  text-align: left;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.frameMark {
  font-size: 16px;
  color: var(--el-text-color-placeholder);

  &.checked {
    color: var(--el-color-primary);
  }
}

.frameLabel {
  flex: 1;
}

.frameThumb {
  width: 64px;
  height: 36px;
  object-fit: cover;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}

.frameThumbPlaceholder {
  display: grid;
  place-items: center;
  width: 64px;
  height: 36px;
  border-radius: 4px;
  color: var(--el-text-color-placeholder);
  background: var(--el-fill-color-light);
}

.frameError {
  max-width: 260px;
  white-space: normal;
  color: var(--el-color-danger);
}
</style>
