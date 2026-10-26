/**
 * 全局媒体播放协调：同一时间只允许一个音视频在播。
 *
 * 画布节点、素材库预览、历史记录等处的播放器都是独立的原生 <video>，
 * 多路同时解码会占满 GPU 解码与合成，叠加画布刷新后表现为整页卡死。
 * 这里用文档级捕获监听统一收敛，组件侧不需要互相通信。
 */

/** 加在媒体元素上可退出协调（例如摄像头预览、缩略图试播）。 */
const CONCURRENT_ATTRIBUTE = "concurrent";

function exempt(element: HTMLMediaElement) {
  return element.dataset[CONCURRENT_ATTRIBUTE] === "on";
}

function mediaElements(root: ParentNode = document, selector = "video,audio") {
  return root.querySelectorAll<HTMLMediaElement>(selector);
}

/** 暂停容器内的媒体；audio=false 时只处理视频（画布切走不应打断音频试听）。 */
export function pauseMediaIn(root: ParentNode, options: { audio?: boolean } = {}) {
  for (const element of mediaElements(root, options.audio === false ? "video" : "video,audio")) {
    if (element.paused || exempt(element)) continue;
    element.pause();
  }
}

// ACT: 用文档上的标记而不是模块变量，开发态热更新重新执行模块时不会重复挂监听。
const INSTALL_KEY = "__toonflowMediaPlayback";

export function installMediaPlayback() {
  const scope = document as Document & { [INSTALL_KEY]?: boolean };
  if (scope[INSTALL_KEY]) return;
  scope[INSTALL_KEY] = true;
  document.addEventListener("play", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLMediaElement) || exempt(target)) return;
    // ACT: 只暂停真正在播的其它媒体，不碰已结束或尚未开始的元素，避免打断预加载。
    for (const element of mediaElements()) {
      if (element === target || element.paused || exempt(element)) continue;
      element.pause();
    }
  }, true);
  // ACT: 隐藏窗口只停视频（后台解码最贵），音频继续播放，避免切标签页打断试听。
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    pauseMediaIn(document, { audio: false });
  });
}
