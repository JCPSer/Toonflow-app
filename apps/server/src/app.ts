import logger from "morgan";
import express from "express";
import { resolve } from "node:path";
import type { Request, Response, NextFunction } from "express";
import buildRoute from "@/core";
import { errorFromCause } from "@/lib/responseFormat";
import desktopRequest from "@/lib/desktop";
import { languageRequest } from "@/lib/i18n";
import { getRuntimePlatform } from "@/lib/platform";
import type { ModuleContext } from "@/types/module";

export async function createApp({
  webRoot, appVersion = "", dataDirectory, toolsRoot, nodesRoot, extRoot, providersRoot, skillsRoot, agentsRoot, pluginRevision,
}: {
  webRoot: string; appVersion?: string; dataDirectory?: string; toolsRoot?: string; nodesRoot?: string;
  extRoot?: string; providersRoot?: string; skillsRoot?: string; agentsRoot?: string; pluginRevision?: string;
}) {
  // ACT: conf 由各模块入口动态求值（入口静态面会传递求值 conf），必须先确定数据目录再装配。
  if (dataDirectory) process.env.TOONFLOW_DATA_DIR = resolve(dataDirectory);
  const [assets, media, plugins, mcp, local, agentAccess, platform] = await Promise.all([
    import("@/modules/assetLibrary"),
    import("@/modules/mediaGeneration"),
    import("@/modules/pluginMarket"),
    import("@/modules/mcpIntegration"),
    import("@/modules/localRuntime"),
    import("@/modules/agentAccess"),
    import("@/modules/platformCore"),
  ]);
  const context: ModuleContext = {
    appVersion, dataDirectory,
    pluginRoots: { tool: toolsRoot, node: nodesRoot, ext: extRoot, skill: skillsRoot, provider: providersRoot, agent: agentsRoot },
    pluginRevision,
    syncPluginDirectory: plugins.syncDirectory,
  };
  await platform.prepare(context);
  await plugins.initializeTools(context);
  await plugins.initializeNodes(context);
  await plugins.initializeExt(context);
  await media.initializeProviders(context);
  assets.warmup(context);
  await plugins.initializeSkills(context);
  await plugins.initializeAgents(context);
  const app = express();
  app.locals.appVersion = appVersion;
  app.locals.builtinPlugins = await plugins.scanBuiltin(context);

  if (getRuntimePlatform().development) {
    await buildRoute();
    app.use(logger("dev"));
  }
  app.use(platform.corsGuard);
  app.use(languageRequest);
  app.use("/a2a", express.json({ limit: "2mb" }));
  app.use(["/api/workspaces/files/write", "/api/assets/save"], express.raw({ type: "application/octet-stream", limit: "100mb" }));
  // ACT: 会话状态体积上限远小于全局；必须在全局解析器之前单独挂载，否则大请求体会先被按 100mb 读入内存。
  app.use("/api/sessionState", express.json({ limit: "64kb" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));
  app.use("/api/desktop", desktopRequest);

  await media.refreshModels();
  const router = await import("@/router");
  router.default(app);
  await mcp.mount(app, context);
  await agentAccess.mount(app, context);
  app.use(express.static(webRoot));

  // 错误处理
  app.use((err: Error & { status?: number }, request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(err);
    console.error(err);
    const body = errorFromCause(err);
    response.status(body.code).json(body);
  });

  await local.initializeRuntime(app, context);
  return app;
}
