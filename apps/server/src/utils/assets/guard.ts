import type { Request } from "express";
import { isMobileLinkRequest } from "@/utils/mobileLink";

/** 与 /api/workspaces/files/* 一致的 workspace-bound 标记；现在只作为同源校验之外的第二层，不能单独授权。 */
export function hasAssetWorkspaceHeader(req: Request) {
  return req.get("x-toonflow-workspace") === "1";
}

/** 只解析 http(s) 来源的 host；沙箱 iframe 的 "null" 与非法值一律不视为同源。 */
function originHost(value: string | undefined) {
  if (!value || value === "null") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.host : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 同源判定以 Host 为准：Origin 优先，缺失时回退 Referer。
 * 不比较协议，兼容 TLS 在反向代理终止（express 看到 http、浏览器发送 https）的部署。
 */
export function isSameOriginAssetRequest(req: Request) {
  const host = req.get("host");
  if (!host) return false;
  const origin = req.get("origin");
  if (origin !== undefined) return originHost(origin) === host;
  return originHost(req.get("referer")) === host;
}

/** 移动端设备令牌已由 mobileLink 网关校验，等价于已授权的 workspace 会话。 */
export function isTrustedMobileAssetRequest(req: Request) {
  return isMobileLinkRequest(req);
}

/**
 * 所有素材库请求都必须来自同源页面（或已通过设备令牌鉴权的移动端）。
 * 自定义头只保留为第二层标记：非媒体请求仍要求携带，但不再能单独绕过同源检查。
 */
export function assertAssetRequest(req: Request, options: { media?: boolean } = {}) {
  if (isTrustedMobileAssetRequest(req)) return;
  if (!isSameOriginAssetRequest(req)) {
    throw Object.assign(new Error("只允许 Toonflow 同源页面访问素材库"), { status: 403, code: "EFORBIDDEN" });
  }
  if (options.media !== true && !hasAssetWorkspaceHeader(req)) {
    throw Object.assign(new Error("素材库写操作需要 Toonflow 工作区标记"), { status: 403, code: "EFORBIDDEN" });
  }
}
