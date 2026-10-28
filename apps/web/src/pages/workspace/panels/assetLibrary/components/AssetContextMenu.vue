<template>
  <el-dropdown
    ref="menuRef"
    trigger="contextmenu"
    virtualTriggering
    :virtual-ref="menuAnchor"
    placement="bottom-start"
    :show-arrow="false"
    :hide-on-click="true"
    popper-class="assetContextMenu"
    @command="handleCommand">
    <template #dropdown>
      <el-dropdown-menu v-if="entry">
        <template v-if="background">
          <el-dropdown-item v-if="canReveal" command="reveal-in-os">{{ revealLabel }}</el-dropdown-item>
          <el-dropdown-item command="new-subfolder">{{ translate("新建文件夹") }}</el-dropdown-item>
          <el-dropdown-item command="upload-here">{{ translate("上传到此") }}</el-dropdown-item>
        </template>
        <template v-else>
          <el-dropdown-item command="open">{{ translate("打开") }}</el-dropdown-item>
          <el-dropdown-item v-if="canReveal" command="reveal-in-os">{{ revealLabel }}</el-dropdown-item>
          <el-dropdown-item v-if="showDetail" command="detail">{{ translate("显示详情") }}</el-dropdown-item>
          <el-dropdown-item command="rename">{{ translate("重命名") }}</el-dropdown-item>
          <el-dropdown-item command="move">{{ translate("移动到…") }}</el-dropdown-item>
          <el-dropdown-item v-if="entry.type === 'directory'" command="new-subfolder">{{ translate("新建子文件夹") }}</el-dropdown-item>
          <el-dropdown-item v-if="entry.type === 'directory'" command="upload-here">{{ translate("上传到此") }}</el-dropdown-item>
          <el-dropdown-item command="meta">{{ translate("标签与备注") }}</el-dropdown-item>
          <el-dropdown-item command="favorite">{{ entry.favorite ? translate("取消收藏") : translate("收藏") }}</el-dropdown-item>
          <el-dropdown-item v-if="entry.type === 'file'" command="download" divided>{{ translate("下载") }}</el-dropdown-item>
          <el-dropdown-item command="delete" divided class="deleteAction">{{ translate("删除") }}</el-dropdown-item>
        </template>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, shallowRef } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { DropdownInstance } from "element-plus";
import type { AssetEntry } from "../types";

export type AssetMenuCommand = "open" | "reveal-in-os" | "detail" | "rename" | "move" | "new-subfolder" | "upload-here" | "meta" | "favorite" | "download" | "delete";
// ACT: 只有宿主真的能展示详情时才出现「显示详情」，避免工作区里出现点了没反应的菜单项。
withDefaults(defineProps<{ showDetail?: boolean; canReveal?: boolean }>(), { showDetail: false, canReveal: false });
const emit = defineEmits<{ command: [command: AssetMenuCommand, entry: AssetEntry] }>();
const menuRef = ref<DropdownInstance>();
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });
const entry = shallowRef<AssetEntry>();
const background = ref(false);
// ACT: 系统文案跟着宿主平台走；隐藏由 canReveal 控制，远程/移动端不渲染该项。
const isMac = globalThis.navigator?.platform?.includes("Mac") ?? false;
const revealLabel = computed(() => translate(isMac ? "在访达中显示" : "在资源管理器中显示"));

async function openMenu(event: MouseEvent, target: AssetEntry, asBackground = false) {
  menuRef.value?.handleClose();
  entry.value = target;
  background.value = asBackground;
  const element = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
  const rect = event.type === "contextmenu" ? new DOMRect(event.clientX, event.clientY, 0, 0)
    : element?.getBoundingClientRect() ?? new DOMRect();
  menuAnchor.value = { getBoundingClientRect: () => rect };
  await nextTick();
  menuRef.value?.handleOpen();
}

function closeMenu() {
  menuRef.value?.handleClose();
}

function handleCommand(command: string) {
  if (!entry.value) return;
  emit("command", command as AssetMenuCommand, entry.value);
}

defineExpose({ openMenu, closeMenu });
</script>

<style scoped lang="scss">
:global(.assetContextMenu .deleteAction:not(.is-disabled)) {
  color: var(--el-color-danger);
}
</style>
