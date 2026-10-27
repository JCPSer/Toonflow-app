import { resolve } from "node:path";
import { readdir } from "@toonflow/file";
import type { BuiltinPluginType, ModuleContext, PluginType, ServerModule } from "@/types/module";
import initializePlugins from "./plugins/initialize";

// R-07C：安装内核的三个符号与技能文件命名空间经此公开入口复用（mcpIntegration 是唯一消费点）。
export { decodeText, skillPath, skillZip } from "./plugins/install";
export { listTools } from "./plugins/tools";
export * as skillFiles from "./skills/files";
export { default as syncDirectory } from "./plugins/initialize";

const toolPattern = /^[a-z][a-zA-Z0-9]*\.tool\.js$/;
const nodePattern = /^[a-z][a-zA-Z0-9]*\.umd\.js$/;
const extPattern = /^ext-[a-z][a-zA-Z0-9]*\.umd\.js$/;
const builtinTypes: readonly BuiltinPluginType[] = ["tool", "node", "ext", "skill", "agent"];

// ACT: 步骤 1/2/6/7 按需补齐目录（保留用户修改）；步骤 3 的 ext 安装器必须保持动态 import。
async function sync(context: ModuleContext, type: PluginType, directory: string, fileFilter?: RegExp, revision?: string) {
  const root = context.pluginRoots[type];
  if (!context.dataDirectory || !root) return;
  await initializePlugins(resolve(context.dataDirectory, directory), root, fileFilter, revision);
}

export async function initializeTools(context: ModuleContext) { await sync(context, "tool", "tools", toolPattern, context.pluginRevision); }
export async function initializeNodes(context: ModuleContext) { await sync(context, "node", "nodes", nodePattern, context.pluginRevision); }
export async function initializeSkills(context: ModuleContext) { await sync(context, "skill", "skills"); }
export async function initializeAgents(context: ModuleContext) { await sync(context, "agent", "agents"); }

export async function initializeExt(context: ModuleContext) {
  if (!context.dataDirectory || !context.pluginRoots.ext) return;
  const { default: syncExt } = await import("./plugins/initializeExt");
  await syncExt(resolve(context.dataDirectory, "ext"), context.pluginRoots.ext, context.pluginRevision);
}

// ACT: 步骤 8：内置身份取自当前发行包目录，不依赖作者或安装记录；更新后的同名插件仍属内置插件。
export async function scanBuiltin(context: ModuleContext) {
  const entries = await Promise.all(builtinTypes.map(async type => {
    const root = context.pluginRoots[type];
    const items = root ? await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }) : [];
    const pattern = type === "tool" ? toolPattern : type === "ext" ? extPattern : nodePattern;
    const names = items.filter(item => type === "skill" || type === "agent" ? item.isDirectory() : item.isFile() && pattern.test(item.name))
      .map(item => item.isDirectory() ? item.name : item.name.replace(/\.(?:tool|umd)\.js$/, ""));
    return [type, new Set(names)] as const;
  }));
  return Object.fromEntries(entries) as Record<BuiltinPluginType, Set<string>>;
}

const module: ServerModule = {
  id: "pluginMarket",
  routePrefixes: ["/api/tools", "/api/nodes", "/api/ext", "/api/skills", "/api/agents", "/api/plugins"],
  dependencies: ["localRuntime", "mediaGeneration", "platformCore"],
  exports: ["syncDirectory", "initializeTools", "initializeNodes", "initializeExt", "initializeSkills", "initializeAgents", "scanBuiltin"],
};
export default module;
