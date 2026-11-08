import { onBeforeUnmount, onMounted } from "vue";
import { primaryModifier, shortcutMatches } from "@/lib/canvasShortcuts";

// ACT: macOS 惯例的「偏好设置」快捷键；非 Mac 平台用 Ctrl+,。
export const settingsShortcut = `${primaryModifier}+Comma`;

/**
 * ACT: 设置面板是首页与工作区各自持有的 el-dialog，快捷键只能挂在页面级开关上。
 * 两个页面都调用这个组合式函数，按键门禁只写一份。
 */
export function useSettingsShortcut(isOpen: () => boolean, setOpen: (open: boolean) => void) {
  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (!shortcutMatches(event, settingsShortcut)) return;
    const overlays = document.querySelectorAll(".el-overlay").length;
    // ACT: 别家弹窗占着焦点时不抢着开设置；设置自己开着时允许关，但设置里又弹了确认框就先让给确认框。
    if (!isOpen() && overlays) return;
    if (isOpen() && overlays > 1) return;
    event.preventDefault();
    setOpen(!isOpen());
  }
  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
}
