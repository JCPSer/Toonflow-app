import { ref } from "vue";
import { developerSettings } from "@/stores/settings";

/**
 * 帧率监测与特效自动降级。
 *
 * WKWebView 下大块 backdrop-filter、SVG 描边动画和视频解码叠加时，合成器容易掉到 30 帧；
 * 这里按 2 秒窗口统计 rAF 帧率，连续掉帧才降级，恢复后自动还原，避免一直牺牲观感。
 */

export const measuredFps = ref(0);
export const lowPerformance = ref(false);

const WINDOW_MS = 2000;
const LOW_FPS = 45;
const RECOVER_FPS = 55;
const INSTALL_KEY = "__toonflowFrameBudget";

function applyLowMode(enabled: boolean) {
  lowPerformance.value = enabled;
  const root = document.documentElement;
  if (enabled) root.dataset.performance = "low";
  else delete root.dataset.performance;
}

export function installFrameBudget() {
  const scope = window as Window & { [INSTALL_KEY]?: boolean };
  if (scope[INSTALL_KEY]) return;
  scope[INSTALL_KEY] = true;
  let frames = 0;
  let windowStart = performance.now();
  let slowWindows = 0;
  let fastWindows = 0;
  const tick = () => {
    frames++;
    const now = performance.now();
    const elapsed = now - windowStart;
    if (elapsed >= WINDOW_MS) {
      const fps = Math.round((frames * 1000) / elapsed);
      frames = 0;
      windowStart = now;
      // 隐藏窗口/后台标签的 rAF 会被限流，不能作为降级依据。
      if (!document.hidden) {
        measuredFps.value = fps;
        if (!developerSettings.value.performanceAutoDegrade) {
          applyLowMode(false);
          slowWindows = 0;
          fastWindows = 0;
        } else if (fps < LOW_FPS) {
          fastWindows = 0;
          if (++slowWindows >= 2 && !lowPerformance.value) applyLowMode(true);
        } else if (fps > RECOVER_FPS) {
          slowWindows = 0;
          if (++fastWindows >= 3 && lowPerformance.value) applyLowMode(false);
        } else {
          slowWindows = 0;
          fastWindows = 0;
        }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
