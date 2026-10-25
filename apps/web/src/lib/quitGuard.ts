/**
 * 关闭闸门的前端入口。
 *
 * 主进程在窗口关闭/退出前执行 `window.__toonflowFlush?.()`，等待前端把文档、画布和会话状态
 * 落盘后回执 `{ type: "flush-done" }`。工作区挂载时注册真实 flush；其它页面保持空实现，
 * 收到调用立即回执，避免首页/设置页关窗时白等主进程超时。
 */
type FlushHandler = () => void | Promise<void>;

let flush: FlushHandler | undefined;
let installed = false;

declare global {
  interface Window {
    /** 主进程注入调用的保存入口；只在桌面端存在。 */
    __toonflowFlush?: () => Promise<void>;
    /** electrobun 预加载脚本提供的宿主消息通道。 */
    __electrobunSendToHost?: (message: unknown) => void;
  }
}

/** 注册/注销当前页面的保存实现；传 undefined 表示回落为立即回执的空实现。 */
export function setQuitFlush(handler?: FlushHandler) {
  flush = handler;
}

function sendFlushDone() {
  try {
    window.__electrobunSendToHost?.({ type: "flush-done" });
  } catch (error) {
    // ACT: 回执通道异常时只记录日志；主进程仍有超时兜底，绝不能让异常打断退出流程。
    console.error("发送关闭保存回执失败：", error);
  }
}

/** 安装默认实现，应用启动时调用一次（幂等）。 */
export function installQuitGuard() {
  if (installed) return;
  installed = true;
  // ACT: finally 无条件回执——保存抛错也要让主进程立刻结束等待，不能靠超时兜底。
  window.__toonflowFlush = async () => {
    try {
      await flush?.();
    } catch (error) {
      // 吞掉异常，避免 executeJavascript 里产生未处理的 Promise rejection；回执仍由 finally 保证。
      console.error("关闭前保存失败：", error);
    } finally {
      sendFlushDone();
    }
  };
}
