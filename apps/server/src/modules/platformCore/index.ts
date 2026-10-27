import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";
import { setLocaleFallback } from "@/lib/i18n";
import type { ModuleContext, ServerModule } from "@/types/module";

// ACT: 步骤 [3]：语言回退必须读宿主数据目录下的配置，因此 conf 只能动态求值（时序见组合根）。
export async function prepare(_context: ModuleContext) {
  const { default: conf } = await import("./conf");
  setLocaleFallback(() => normalizeLocale((conf.get("settings", {}).ui as { language?: unknown } | undefined)?.language)
    ?? detectLocale([Intl.DateTimeFormat().resolvedOptions().locale]));
}

/**
 * CORS 只放行同源页面、无 Origin 的本机/命令行调用，以及携带设备令牌的移动端。
 * 不返回 "*"，也不回显未经校验的 Origin；真正的安全边界仍由各路由的同源校验负责。
 */
function corsOriginAllowed(request: Request, origin: string) {
  if (origin === "null") return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.host === request.get("host")) return true;
  } catch {
    return false;
  }
  // 移动端经设备令牌网关转发；浏览器跨源预检不会携带该自定义头，因此无法借此绕过。
  return /^[\w-]{32,256}$/.test(request.get("x-toonflow-device-token") ?? "");
}

export function corsGuard(request: Request, response: Response, next: NextFunction) {
  const origin = request.get("origin");
  if (origin !== undefined && !corsOriginAllowed(request, origin)) {
    response.status(403).json({ code: 403, data: null, message: "跨源请求已被拒绝" });
    return;
  }
  cors({ origin: origin ?? false, credentials: false, maxAge: 86400 })(request, response, next);
}

const module: ServerModule = {
  id: "platformCore",
  routePrefixes: ["/api/settings", "/api/monitor"],
  dependencies: ["localRuntime"],
  exports: ["prepare", "corsGuard"],
};
export default module;
