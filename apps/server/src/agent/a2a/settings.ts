import { createHash, timingSafeEqual } from "node:crypto";
import { realpath, stat } from "@toonflow/file";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Request } from "express";
import { getAgentHost } from "@/agent/host";
import { thinkingLevels, type ThinkingLevel } from "@toonflow/formats/modelReasoning";
import type { A2aSettings } from "@toonflow/formats/a2a";

export type { A2aSettings };

let controller = new AbortController();
let watcherInstalled = false;

export function getA2aSettings(): A2aSettings {
  const value = (getAgentHost().settings.get("a2a") ?? {}) as Partial<Record<keyof A2aSettings, unknown>>;
  return {
    enabled: value?.enabled === true,
    directory: typeof value?.directory === "string" ? value.directory : "",
    token: typeof value?.token === "string" ? value.token : "",
    providerId: typeof value?.providerId === "string" ? value.providerId : "",
    modelId: typeof value?.modelId === "string" ? value.modelId : "",
    thinkingLevel: thinkingLevels.includes(value.thinkingLevel as ThinkingLevel) ? value.thinkingLevel as ThinkingLevel : undefined,
  };
}

export function getA2aUrl(req: Request) {
  return `${req.protocol}://${req.get("host")}/a2a`;
}

export async function resolveA2aWorkspace(path = getA2aSettings().directory) {
  const host = getAgentHost();
  if (!isAbsolute(path)) throw Object.assign(new Error("请配置 A2A 工作目录的绝对路径"), { status: 400 });
  const directory = await realpath(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw Object.assign(new Error("A2A 工作目录不存在，请重新选择"), { status: 404 });
    throw error;
  });
  if (!(await stat(directory)).isDirectory()) throw Object.assign(new Error("A2A 工作目录必须是文件夹"), { status: 400 });
  if (host.platform.getRuntimePlatform().local) return directory;
  const root = await realpath(resolve(dirname(host.settings.settingsPath()), "workspaces")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return;
    throw error;
  });
  if (!root || !host.workspace.isWithin(root, directory)) throw Object.assign(new Error("服务器部署只能使用服务器工作区"), { status: 403 });
  return directory;
}

export function authenticateA2a(req: Request) {
  const host = getAgentHost();
  const { enabled, token } = getA2aSettings();
  if (!enabled || token.length < 32) return;
  if (host.platform.getRuntimePlatform().requiresLocalHost && !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname)) return;
  if (req.get("origin")) {
    try {
      host.mcp.getAppOrigin({
        origin: req.get("origin"), referer: req.get("referer"), host: req.get("host"), hostname: req.hostname,
        mobileLink: req.res?.locals?.toonflowMobileLink === true,
      });
    } catch { return; }
  }
  const actual = Buffer.from(req.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return;
  return createHash("sha256").update(token).digest("hex");
}

export function getA2aSignal() {
  registerA2aSettingsWatcher();
  return controller.signal;
}

// ACT: 迁移到注入之后惰性注册：注册本身需要 AgentHost，模块顶层注册会把配置求值时机绑到 agent 装载时机。
export function registerA2aSettingsWatcher() {
  if (watcherInstalled) return;
  getAgentHost().settings.onChange("a2a", (next, previous) => {
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    const previousController = controller;
    controller = new AbortController();
    previousController.abort(new Error("A2A 设置已修改，当前任务已取消"));
  });
  // 注册成功后才置位：注入前调用会抛错，下一次调用必须能重试注册。
  watcherInstalled = true;
}
