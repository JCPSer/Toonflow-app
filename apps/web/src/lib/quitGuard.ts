/**
 * 关闭闸门的前端入口。
 *
 * 主进程在窗口关闭/退出前执行 `window.__toonflowFlush?.(kind)`，等待前端把文档、画布和会话状态
 * 落盘后回执 `{ type: "flush-done" }`。工作区挂载时注册真实 flush；其它页面保持空实现，
 * 收到调用立即回执，避免首页/设置页关窗时白等主进程超时。
 *
 * ACT: 有节点在跑时，工作区还会注册运行中确认。确认发生在落盘之前——用户可能直接取消退出，
 * 这时既不该关窗也不该再写盘。主进程据此把本轮闸门作废（`flush-cancelled`），
 * 并先用 `flush-confirming` 暂停原有的 4 秒超时、把窗口前置。
 */
import { countRunningNodes } from "./runningNodes";

type FlushHandler = () => void | Promise<void>;
/** 主进程注入的事件类型：更新重启（update）不弹运行中确认，走更新器自己的退出审批。 */
type QuitKind = "close" | "quit" | "update";
type QuitConfirm = (count: number) => Promise<boolean>;

let flush: FlushHandler | undefined;
let confirmQuit: QuitConfirm | undefined;
let installed = false;

declare global {
  interface Window {
    /** 主进程注入调用的保存入口；只在桌面端存在。 */
    __toonflowFlush?: (kind?: QuitKind) => Promise<void>;
    /** electrobun 预加载脚本提供的宿主消息通道。 */
    __electrobunSendToHost?: (message: unknown) => void;
  }
}

/** 注册/注销当前页面的保存实现；传 undefined 表示回落为立即回执的空实现。 */
export function setQuitFlush(handler?: FlushHandler) {
  flush = handler;
}

/** 注册/注销「有节点在运行，是否仍要退出」的确认；只有工作区页面会注册。 */
export function setQuitConfirm(handler?: QuitConfirm) {
  confirmQuit = handler;
}

function sendToHost(message: unknown) {
  try {
    window.__electrobunSendToHost?.(message);
  } catch (error) {
    // ACT: 回执通道异常时只记录日志；主进程仍有超时兜底，绝不能让异常打断退出流程。
    console.error("发送关闭流程消息失败：", error);
  }
}

/** 安装默认实现，应用启动时调用一次（幂等）。 */
export function installQuitGuard() {
  if (installed) return;
  installed = true;
  window.__toonflowFlush = async (kind: QuitKind = "close") => {
    // ACT: 计数/确认都不能挡住关窗：取不到数量就当没有节点，确认抛错就当用户同意。
    if (kind !== "update" && confirmQuit) {
      let count = 0;
      try { count = countRunningNodes(); } catch (error) { console.error("统计运行中节点失败：", error); }
      if (count > 0) {
        sendToHost({ type: "flush-confirming" });
        let approved = true;
        try { approved = await confirmQuit(count); } catch (error) { console.error("退出确认失败，按同意处理：", error); }
        if (!approved) {
          // 用户留在原地：不发 flush-done，主进程据此取消本轮关闭/退出。
          sendToHost({ type: "flush-cancelled" });
          return;
        }
      }
    }
    // ACT: finally 无条件回执——保存抛错也要让主进程立刻结束等待，不能靠超时兜底。
    try {
      await flush?.();
    } catch (error) {
      // 吞掉异常，避免 executeJavascript 里产生未处理的 Promise rejection；回执仍由 finally 保证。
      console.error("关闭前保存失败：", error);
    } finally {
      sendToHost({ type: "flush-done" });
    }
  };
}
