import type { Application } from "express";

// ACT: 模块契约只描述结构与职责，不含任何实现；插件类型词表与安装器 patterns 的六类一一对应。
export type PluginType = "tool" | "node" | "ext" | "skill" | "provider" | "agent";
export type BuiltinPluginType = "tool" | "node" | "ext" | "skill" | "agent";
export type PluginRoots = { [K in PluginType]?: string };

export type ModuleContext = {
  appVersion: string;
  dataDirectory?: string;
  pluginRoots: PluginRoots;
  pluginRevision?: string;
  syncPluginDirectory?(target: string, source: string, fileFilter?: RegExp | readonly string[], revision?: string): Promise<void>;
};

export type ServerModuleId = "assetLibrary" | "mediaGeneration" | "pluginMarket" | "mcpIntegration" | "localRuntime" | "agentAccess" | "platformCore";

export type ServerModule = {
  id: ServerModuleId;
  routePrefixes: readonly string[];
  gateways?: readonly string[];
  // ACT: dependencies 是该模块的“实测出边”（扫 `@/modules/<id>` 与动态 import()），不是愿望清单；
  // 改跨模块引用时同步本字段、AGENTS.md 模块表与地图子图。仓库规则不新增自检命令，故不做运行时校验。
  dependencies: readonly string[];
  exports: readonly string[];
  initialize?(context: ModuleContext): Promise<void>;
  warmup?(context: ModuleContext): void;
  mount?(app: Application, context: ModuleContext): Promise<void>;
};
