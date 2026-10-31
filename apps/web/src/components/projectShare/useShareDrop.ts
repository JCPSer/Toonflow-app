import { onMounted, onUnmounted, ref } from "vue";
import { isShareFile } from "@/lib/projectShare";

/**
 * 拖拽中的单个文件。WKWebView 在 dragover 阶段不一定给出文件名（`getAsFile()` 可能为 null），
 * 那时返回 `unknown`：仍然拦下 dragover（否则 drop 根本不会派发），但只在 drop 时按扩展名认领。
 */
function draggedShareFile(event: DragEvent): "share" | "unknown" | null {
  const items = event.dataTransfer?.items;
  if (!items || items.length !== 1 || items[0]?.kind !== "file") return null;
  const file = items[0].getAsFile();
  return file && isShareFile(file) ? "share" : "unknown";
}

function droppedShareFile(event: DragEvent): File | null {
  const files = Array.from(event.dataTransfer?.files ?? []);
  return files.length === 1 && isShareFile(files[0]!) ? files[0]! : null;
}

/**
 * 首页/工程页共用：只拦截「单个 .tfproj」的拖放。
 * ACT: 监听挂在 window 捕获阶段，先于卡片等内部 drop 处理器执行；
 * 非分享文件直接放行，不 preventDefault、不 stopPropagation。
 */
export function useShareFileDrop(onFile: (file: File) => void) {
  const dragging = ref(false);

  function onDrag(event: DragEvent) {
    const kind = draggedShareFile(event);
    if (!kind) return;
    // ACT: 必须拦下 dragover，否则浏览器不派发 drop；但**不能** stopPropagation——
    // 否则画布、素材库、输入框的拖放高亮全部失效。只有确认是 .tfproj 时才显示遮罩。
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dragging.value = kind === "share";
  }

  function onDrop(event: DragEvent) {
    const file = droppedShareFile(event);
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    dragging.value = false;
    onFile(file);
  }

  function onLeaveWindow(event: DragEvent) {
    if (!event.relatedTarget) dragging.value = false;
  }

  function reset() {
    dragging.value = false;
  }

  onMounted(() => {
    window.addEventListener("dragenter", onDrag, true);
    window.addEventListener("dragover", onDrag, true);
    window.addEventListener("dragleave", onLeaveWindow);
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", reset, true);
    window.addEventListener("blur", reset);
  });

  onUnmounted(() => {
    window.removeEventListener("dragenter", onDrag, true);
    window.removeEventListener("dragover", onDrag, true);
    window.removeEventListener("dragleave", onLeaveWindow);
    window.removeEventListener("drop", onDrop, true);
    window.removeEventListener("dragend", reset, true);
    window.removeEventListener("blur", reset);
  });

  return { dragging };
}
