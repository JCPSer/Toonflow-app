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
          <el-dropdown-item command="new-subfolder">{{ translate("新建文件夹") }}</el-dropdown-item>
          <el-dropdown-item command="upload-here">{{ translate("上传到此") }}</el-dropdown-item>
        </template>
        <template v-else>
          <el-dropdown-item command="open">{{ translate("打开") }}</el-dropdown-item>
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
import { nextTick, ref, shallowRef } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { DropdownInstance } from "element-plus";
import type { AssetEntry } from "../types";

export type AssetMenuCommand = "open" | "rename" | "move" | "new-subfolder" | "upload-here" | "meta" | "favorite" | "download" | "delete";
const emit = defineEmits<{ command: [command: AssetMenuCommand, entry: AssetEntry] }>();
const menuRef = ref<DropdownInstance>();
const menuAnchor = shallowRef({ getBoundingClientRect: () => new DOMRect() });
const entry = shallowRef<AssetEntry>();
const background = ref(false);

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
