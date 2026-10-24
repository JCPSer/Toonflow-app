<template>
  <div class="canvasOverlays" aria-live="off">
    <div v-for="item in overlays" :key="item.id" class="overlaySlot">
      <component :is="item.component" :context="item.context" />
    </div>
    <div v-for="item in failed" :key="item.id" class="overlayError" role="status">浮层插件加载失败：{{ item.message }}</div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, type Component } from "vue";
import type { ExtContext, ExtFiles } from "@toonflow/ext-scaffold/runtime";
import { writeClipboardText } from "@/lib/clipboard";
import { isMobile } from "@/lib/platform";
import { extensionConfig, listExtensions, loadExtension, saveExtensionConfig, type InstalledExtension } from "../document/extensions";

type OverlayContext = ExtContext<{ kind: "canvasOverlay" }>;
type Overlay = { id: string; component: Component; context: OverlayContext };

const overlays = shallowRef<Overlay[]>([]);
const failed = shallowRef<{ id: string; message: string }[]>([]);
let disposed = false;
let loading = 0;

// ACT: 浮层不碰工作区文件，宿主只提供一组会明确报错的空实现，避免插件误用。
function unavailable(method: string): never {
  throw new Error(`画布浮层不支持 ${method}`);
}

const files: ExtFiles = {
  list: () => unavailable("文件列表"),
  read: () => unavailable("读取文件"),
  readText: () => unavailable("读取文本"),
  readJson: () => unavailable("读取 JSON"),
  write: () => unavailable("写入文件"),
  writeJson: () => unavailable("写入 JSON"),
  acquireUrl: () => unavailable("获取文件地址"),
  rename: () => unavailable("重命名"),
  copy: () => unavailable("复制文件"),
  reveal: () => unavailable("定位文件"),
  remove: () => unavailable("删除文件"),
  mkdir: () => unavailable("新建文件夹"),
};

function createContext(extension: InstalledExtension): OverlayContext {
  return {
    resource: { kind: "canvasOverlay" },
    files,
    text: "",
    loading: false,
    error: "",
    dirty: false,
    active: true,
    get config() { return extensionConfig(extension.id); },
    saveConfig: config => saveExtensionConfig(extension.id, config),
    updateText: () => unavailable("编辑文本"),
    flushSave: async () => {},
    writeClipboardText,
    openFile: async () => unavailable("打开文件"),
  };
}

async function refresh() {
  const current = ++loading;
  try {
    const extensions = (await listExtensions()).filter(extension => extension.resourceKind === "canvasOverlay" && extension.enabled && !extension.loadError);
    const loaded: Overlay[] = [];
    const errors: { id: string; message: string }[] = [];
    for (const extension of extensions) {
      try {
        const definition = await loadExtension(extension);
        const component = await definition.load();
        loaded.push({ id: extension.id, component: component.default, context: createContext(extension) });
      } catch (error) {
        errors.push({ id: extension.id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (disposed || current !== loading) return;
    overlays.value = loaded;
    failed.value = errors;
  } catch {
    if (!disposed && current === loading) { overlays.value = []; failed.value = []; }
  }
}

function extensionsUpdated() { void refresh(); }
onMounted(() => {
  // ACT: 监控接口只对本机开放，移动端/远端浏览器不挂浮层，避免一直显示离线。
  if (!isMobile) void refresh();
  // ACT: 只监听插件增删/启停；每次保存配置都会发 ext-config-updated，跟着重载会让浮层反复重建。
  window.addEventListener("toonflow:ext-updated", extensionsUpdated);
});
onBeforeUnmount(() => {
  disposed = true;
  loading++;
  overlays.value = [];
  window.removeEventListener("toonflow:ext-updated", extensionsUpdated);
});
</script>

<style lang="scss" scoped>
.canvasOverlays {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;

  .overlaySlot {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .overlayError {
    position: absolute;
    top: 12px;
    left: 50%;
    padding: 4px 10px;
    border-radius: 6px;
    background: var(--el-color-danger-light-9);
    color: var(--el-color-danger);
    font-size: 12px;
    transform: translateX(-50%);
    pointer-events: none;
  }
}
</style>
