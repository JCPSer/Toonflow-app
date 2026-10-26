import logger from "morgan";
import express from "express";
import cors from "cors";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readFile, readdir } from "@toonflow/file";
import type { Request, Response, NextFunction } from "express";
import buildRoute from "@/core";
import { errorFromCause } from "@/lib/responseFormat";
import desktopRequest from "@/lib/desktop";
import { getRuntimePlatform } from "@/lib/platform";
import initializePlugins from "@/utils/plugins/initialize";
import { languageRequest, resolveRequestLocale, runWithLocale, setLocaleFallback, translateError, translateMessage } from "@/lib/i18n";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";

const autoInstallProviders = ["tfRouter.ts", "apiMart.ts", "metaso.ts", "compshare.ts"];

/**
 * CORS 只放行同源页面、无 Origin 的本机/命令行调用，以及携带设备令牌的移动端。
 * 不返回 "*"，也不回显未经校验的 Origin；真正的安全边界仍由各路由的同源校验负责。
 */
function corsOriginAllowed(req: Request, origin: string) {
  if (origin === "null") return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.host === req.get("host")) return true;
  } catch {
    return false;
  }
  // 移动端经设备令牌网关转发；浏览器跨源预检不会携带该自定义头，因此无法借此绕过。
  return /^[\w-]{32,256}$/.test(req.get("x-toonflow-device-token") ?? "");
}

export async function createApp({
  webRoot,
  appVersion = "",
  dataDirectory,
  toolsRoot,
  nodesRoot,
  extRoot,
  providersRoot,
  skillsRoot,
  agentsRoot,
  pluginRevision,
}: {
  webRoot: string;
  appVersion?: string;
  dataDirectory?: string;
  toolsRoot?: string;
  nodesRoot?: string;
  extRoot?: string;
  providersRoot?: string;
  skillsRoot?: string;
  agentsRoot?: string;
  pluginRevision?: string;
}) {
  // conf 由下方的路由动态加载，必须先确定整个进程共用的数据目录。
  if (dataDirectory) process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory);
  const { default: conf } = await import("@/utils/conf");
  setLocaleFallback(() => normalizeLocale((conf.get("settings", {}).ui as { language?: unknown } | undefined)?.language)
    ?? detectLocale([Intl.DateTimeFormat().resolvedOptions().locale]));
  if (dataDirectory && toolsRoot)
    await initializePlugins(resolve(dataDirectory, "tools"), toolsRoot, /^[a-z][a-zA-Z0-9]*\.tool\.js$/, pluginRevision);
  if (dataDirectory && nodesRoot) await initializePlugins(resolve(dataDirectory, "nodes"), nodesRoot, /^[a-z][a-zA-Z0-9]*\.umd\.js$/, pluginRevision);
  if (dataDirectory && extRoot) {
    const { default: initializeExt } = await import("@/utils/plugins/initializeExt");
    await initializeExt(resolve(dataDirectory, "ext"), extRoot, pluginRevision);
  }
  // ACT: 内置媒体供应商随构建同步，其他供应商文件和独立保存的配置保留。
  if (dataDirectory && providersRoot) {
    const sourceDirectory = resolve(providersRoot, "media");
    let providerRevision = pluginRevision;
    if (providerRevision === undefined) {
      const hash = createHash("sha256");
      for (const name of autoInstallProviders) {
        const source = await readFile(resolve(sourceDirectory, name)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return Buffer.alloc(0);
          throw error;
        });
        hash.update(name).update("\0").update(source).update("\0");
      }
      providerRevision = hash.digest("hex");
    }
    await initializePlugins(resolve(dataDirectory, "providers"), sourceDirectory, autoInstallProviders, providerRevision);
  }
  // ACT: 缩略图缓存目录在模块加载时由 conf 决定，必须在确定 TOONFLOW_DATA_DIR 之后动态引入。
  void import("@/utils/assets/thumb").then(({ sweepThumbnailCache }) => sweepThumbnailCache()).catch(() => {});
  // ACT: 技能和团队只补首次安装，保留用户修改。
  if (dataDirectory && skillsRoot) await initializePlugins(resolve(dataDirectory, "skills"), skillsRoot);
  if (dataDirectory && agentsRoot) await initializePlugins(resolve(dataDirectory, "agents"), agentsRoot);
  const app = express();
  app.locals.appVersion = appVersion;
  // ACT: 内置身份取自当前发行包的目录，不依赖作者或安装记录；更新后的同名插件仍属于内置插件。
  app.locals.builtinPlugins = Object.fromEntries(await Promise.all(
    Object.entries({ tool: toolsRoot, node: nodesRoot, ext: extRoot, skill: skillsRoot, agent: agentsRoot }).map(async ([type, root]) => {
      const entries = root ? await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }) : [];
      const pattern = type === "tool" ? /^[a-z][a-zA-Z0-9]*\.tool\.js$/ : type === "ext" ? /^ext-[a-z][a-zA-Z0-9]*\.umd\.js$/ : /^[a-z][a-zA-Z0-9]*\.umd\.js$/;
      const names = entries.filter(entry => type === "skill" || type === "agent" ? entry.isDirectory() : entry.isFile() && pattern.test(entry.name))
        .map(entry => entry.isDirectory() ? entry.name : entry.name.replace(/\.(?:tool|umd)\.js$/, ""));
      return [type, new Set(names)];
    }),
  ));

  if (getRuntimePlatform().development) {
    await buildRoute();
    app.use(logger("dev"));
  }
  app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin !== undefined && !corsOriginAllowed(request, origin)) {
      response.status(403).json({ code: 403, data: null, message: "跨源请求已被拒绝" });
      return;
    }
    cors({ origin: origin ?? false, credentials: false, maxAge: 86400 })(request, response, next);
  });
  app.use(languageRequest);
  app.use("/a2a", express.json({ limit: "2mb" }));
  app.use(["/api/workspaces/files/write", "/api/assets/save"], express.raw({ type: "application/octet-stream", limit: "100mb" }));
  // ACT: 会话状态体积上限远小于全局；必须在全局解析器之前单独挂载，否则大请求体会先被按 100mb 读入内存。
  app.use("/api/sessionState", express.json({ limit: "64kb" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));
  app.use("/api/desktop", desktopRequest);

  const { default: initializeProviderModels } = await import("@/utils/ai/initialize");
  // ACT: 启动先使用已有模型，远程刷新不阻塞服务监听。
  void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error));
  const router = await import("@/router");
  router.default(app);
  const [{ createMcpRouter }, { getMcpTools }, { authorizeMcp }, { skillResources }] = await Promise.all([
    import("@toonflow/mcp"),
    import("@/utils/mcp/tools"),
    import("@/utils/mcp/control"),
    import("@/utils/mcp/resources"),
  ]);
  app.use("/mcp", createMcpRouter({ getTools: getMcpTools, authorize: authorizeMcp, resources: skillResources,
    runInRequest: (request, operation) => runWithLocale(resolveRequestLocale(request.get("accept-language")), operation),
    translate: translateMessage,
    translateError,
  }));
  const { createA2aRouter } = await import("@/agent/a2a");
  app.use("/a2a", createA2aRouter());
  app.use(express.static(webRoot));

  // 错误处理
  app.use((err: Error & { status?: number }, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(err);
    console.error(err);
    const body = errorFromCause(err);
    response.status(body.code).json(body);
  });

  const { initializeMobileLinkRuntime } = await import("@/utils/mobileLink");
  initializeMobileLinkRuntime(app);
  return app;
}
