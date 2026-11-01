import type { Request, Response, NextFunction } from "express";
import { error } from "@/lib/responseFormat";

/** 桌面桥拒绝原因落日志：剪贴板等原生能力只在桌面页可用，线上排查需要知道是被哪道校验拦下的。 */
function logRejected(req: Request, reason: string) {
  const fields = {
    reason, method: req.method, path: req.originalUrl, host: req.get("host"),
    origin: req.get("origin"), referer: req.get("referer"), desktop: req.get("x-toonflow-desktop"),
    clipboardId: req.get("x-toonflow-clipboard-id"), ua: req.get("user-agent"),
  };
  // ACT: agent 能力统一经 agentRuntime 门面访问；这里用动态加载，避免应用启动就拉起整个 agent 运行时。
  void import("@/agentRuntime").then(({ agentLog }) => agentLog("desktop.request.rejected", fields)).catch(() => {});
}

export default function desktopRequest(req: Request, res: Response, next: NextFunction) {
  if (!req.app.locals.desktop) {
    logRejected(req, "no-runtime");
    return res.status(404).json(error("此接口仅在桌面客户端中可用", null, 404));
  }
  if (req.method !== "POST") return next();
  const localOrigin = `http://${req.get("host")}`;
  const origin = req.get("origin");
  // ACT: WebView2 可能省略 Origin；仅缺失时使用带路径分隔符的同源 Referer。
  const isSameOrigin = origin === undefined ? req.get("referer")?.startsWith(`${localOrigin}/`) : origin === localOrigin;
  if (req.hostname !== "127.0.0.1" || !isSameOrigin || req.get("x-toonflow-desktop") !== "1") {
    logRejected(req, "guard");
    return res.status(403).json(error("仅允许桌面页面发起操作。", null, 403));
  }
  next();
}
