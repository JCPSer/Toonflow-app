import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "@toonflow/file";
import type { ModuleContext, ServerModule } from "@/types/module";

// R-07B：插件安装内核只经此公开入口取用内置媒体供应商注册能力。
export { addMediaProvider } from "./media/provider";

const autoInstallProviders = ["tfRouter.ts", "apiMart.ts", "metaso.ts", "compshare.ts"];

// ACT: 步骤 4：内置媒体供应商随构建同步；其他供应商文件与用户配置保留。
export async function initializeProviders(context: ModuleContext) {
  if (!context.dataDirectory || !context.pluginRoots.provider || !context.syncPluginDirectory) return;
  const sourceDirectory = resolve(context.pluginRoots.provider, "media");
  let providerRevision = context.pluginRevision;
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
  await context.syncPluginDirectory(resolve(context.dataDirectory, "providers"), sourceDirectory, autoInstallProviders, providerRevision);
}

// ACT: 步骤 9：先使用已有模型，远程刷新不阻塞服务监听（warn 型，与步骤 5 的静默吞错语义不同）。
export async function refreshModels() {
  const { default: initializeProviderModels } = await import("./ai/initialize");
  void initializeProviderModels().catch(error => console.warn("启动时刷新供应商模型失败：", error));
}

const module: ServerModule = {
  id: "mediaGeneration",
  routePrefixes: ["/api/ai", "/api/ffmpeg", "/api/providers"],
  dependencies: ["localRuntime", "platformCore"],
  exports: ["initializeProviders", "refreshModels"],
  initialize: initializeProviders,
};
export default module;
