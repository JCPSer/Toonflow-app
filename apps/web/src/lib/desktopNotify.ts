/**
 * 桌面系统通知通道。
 *
 * ACT: 只有桌面壳的预加载脚本提供 __electrobunSendToHost，web 模式没有原生通知，直接跳过。
 * 这里只负责「怎么发」；是否该发（窗口是否在后台、用户是否关了通知）由调用方判断。
 */
import { isDesktop } from "@/lib/platform";

export function notifyDesktop(message: { title: string; body: string }) {
  if (!isDesktop || typeof window === "undefined") return;
  if (typeof window.__electrobunSendToHost !== "function") return;
  try {
    // silent: 提示音由 chime.ts 统一处理，避免系统通知音和合成音先后响两遍。
    window.__electrobunSendToHost({ type: "desktop-notify", title: message.title, body: message.body, silent: true });
  } catch (error) {
    console.error("发送桌面通知失败：", error);
  }
}
