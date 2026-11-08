import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * 悬停显隐状态机：显示无延迟、收起留 400ms 缓冲，指针仍悬停或键盘聚焦时保持显示。
 * ACT: 收起以「hovering + activeElement」状态为准，不依赖 mouseleave → mouseenter 的派发顺序；
 * 工作区左右两侧的素材库入口共用这一套逻辑。
 * 160ms 时用户反馈「移过去大概率又消失、点不到」——按钮与热区之间有距离，鼠标绕行超过缓冲就收起，放宽到 400ms。
 */
export function useHoverReveal(button: Ref<HTMLElement | undefined>) {
  const visible = ref(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;

  function show() {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    visible.value = true;
  }

  function onHoverStart() {
    hovering = true;
    show();
  }

  function onHoverEnd() {
    hovering = false;
    scheduleHide();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      // ACT: 指针仍在热区/按钮上或键盘聚焦中都不隐藏；焦点离开时 blur 会再调一次。
      if (hovering) return;
      if (button.value && document.activeElement === button.value) return;
      visible.value = false;
    }, 400);
  }

  function hideNow() {
    clearTimeout(hideTimer);
    hideTimer = undefined;
    visible.value = false;
  }

  // ACT: 窗口失焦时先把焦点从入口移走，否则隐藏后会留下一个看不见却仍可 Enter 触发的按钮。
  function handleWindowBlur() {
    if (button.value && document.activeElement === button.value) button.value.blur();
    hideNow();
  }

  // ACT: 失焦期间指针可能一直停在按钮上（不会再派发 mouseenter），回到窗口时按悬停状态补显示。
  function handleWindowFocus() {
    if (hovering) show();
  }

  // ACT: macOS 光标移出窗口不触发 window blur；mouseleave 不冒泡，挂在 documentElement 上才收得到。
  function handleDocumentLeave() {
    scheduleHide();
  }

  onMounted(() => {
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("focus", handleWindowFocus);
    document.documentElement.addEventListener("mouseleave", handleDocumentLeave);
  });
  onBeforeUnmount(() => {
    clearTimeout(hideTimer);
    window.removeEventListener("blur", handleWindowBlur);
    window.removeEventListener("focus", handleWindowFocus);
    document.documentElement.removeEventListener("mouseleave", handleDocumentLeave);
  });

  return { visible, show, hideNow, onHoverStart, onHoverEnd, scheduleHide };
}
