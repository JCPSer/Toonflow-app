import type { KnownApi, Model } from "@earendil-works/pi-ai";
import type { TeamManifest } from "@toonflow/teams-scaffold/runtime";

// ACT: agent 域只依赖本契约；应用侧能力由组合根在装配期注入，切断 agent → 应用层（@/modules、@/lib、@/utils）的静态依赖。
// 契约内不出现 express/Request/conf：请求相关数据以普通对象传入，进程状态以函数引用转发。

/** 工作区路径解析结果；与 localRuntime/workspace/files 的返回值结构一致。 */
export type WorkspacePath = { directory: string; path: string };

/** 素材库选择器；结构型重声明，避免契约反向依赖 @/modules/assetLibrary。 */
export type AssetLibrarySelector = { library?: "global" | "project"; directory?: string; cwd?: string };

/** 已打开素材库的定位信息；结构型重声明。 */
export type AssetLibrary = { kind: "global" | "project"; root: string; relativePath: string; fallback?: boolean; workspace?: string };

/** 请求中的文件引用；结构型重声明，字段与 mediaGeneration/ai/requestFiles 一致。 */
export type RequestFile = {
  id?: string;
  data: string;
  mimeType: string;
  readonly inlineBytes: number;
  replace(file: { data: string; mimeType: string }, note?: string): void;
  offload(text: string): void;
  useReference(part: Record<string, unknown>): void;
};

/** 宿主能力摘要；结构型重声明，字段与 lib/platform 的 getRuntimePlatform 返回值一致。 */
export type RuntimePlatform = {
  id: string;
  os: string;
  development: boolean;
  desktop: boolean;
  mobile: boolean;
  local: boolean;
  native: boolean;
  host: boolean;
  nativeDevelopment: boolean;
  requiresLocalHost: boolean;
};

/** 应用来源判定的入参：请求头字段 + 移动互联标志，替代 express Request。 */
export type AppOriginRequest = { origin?: string | null; referer?: string | null; host?: string | null; hostname?: string; mobileLink?: boolean };

/** 模型引用项；与 aiReferenceSchema 的解析结果结构一致。 */
export type AgentReference =
  | { dataType: "STRING"; value: string }
  | { dataType: "IMAGE" | "VIDEO" | "FILE"; value: { url: string; mimeType: string } };

/** 供应商配置里的单个模型；与 providerSchema 的 models 项结构一致。 */
export type ProviderModel = { id: string; label: string; contextWindow?: number; maxOutputTokens?: number; reasoningEfforts?: unknown };

/** 供应商配置；与 providerSchema 的解析结果结构一致。 */
export type ProviderConfig = {
  apiUrl: string;
  apiKey: string;
  protocol: string;
  maxRequestImageBytes?: number;
  maxRequestBytes?: number;
  models: readonly ProviderModel[];
};

/** 模型协议兼容项；直接复用 SDK 的联合类型，避免契约自造一个不等价的形状。 */
export type ModelCompat = NonNullable<Model<KnownApi>["compat"]>;

/** 已配置模型（含推理档位推导结果）。 */
export type ConfiguredModel = {
  provider: ProviderConfig;
  model: ProviderModel & { reasoning: boolean; reasoningLevels: readonly string[]; thinkingLevelMap: Record<string, string | null | undefined>; compat?: ModelCompat; contextWindow: number; maxOutputTokens: number };
  baseUrl: string;
};

// 说明：teams/tools/mcp/assets/media 的返回值是应用域对象，形状由实现方维护；端口只做透传，
// 因此对这些值使用 any 而不是在契约里复制一份业务类型，避免契约与实现双重维护、逐步漂移。
/** MCP 控制连接的最小形状；只声明 agent 实际读取的字段。 */
export type McpConnection = { id: string; state: { directory: string | null; canvasId: string | null; tools: any[] } };

export type AgentHost = {
  readonly workspace: {
    resolveWorkspacePath(root: string, path: string, allowMissingParents?: boolean): Promise<WorkspacePath>;
    lockWorkspaceFiles(paths: string[]): () => void;
    writeWorkspaceFile(path: string, content: string | Uint8Array, exclusive?: boolean): Promise<void>;
    renameWorkspaceFile(source: string, target: string): Promise<void>;
    isWithin(root: string, path: string): boolean;
    isHiddenWorkspaceEntry(name: string): boolean;
    protectWorkspaceRoot(directory: string, path: string): void;
    protectWorkspaceLibraryPath(directory: string, path: string, options?: { allowProjectUi?: boolean; allowProjectUiDirectory?: boolean }): void;
    importImage(cwd: string, value: string): Promise<{ path: string; mimeType: string }>;
  };
  readonly settings: {
    get(section: string, fallback?: Record<string, unknown>): Record<string, unknown>;
    onChange(section: string, callback: (next: unknown, previous: unknown) => void): void;
    settingsPath(): string;
  };
  readonly assets: {
    openAssetLibrary(selector?: AssetLibrarySelector): Promise<AssetLibrary>;
    createAssetDirectory(path: string, selector?: AssetLibrarySelector): Promise<any>;
    importAssetFile(cwd: string, path: string, target?: string, signal?: AbortSignal, selector?: AssetLibrarySelector): Promise<{ path: string; workspacePath: string; revision: string }>;
    importFileIntoLibrary(target: AssetLibrary, sourcePath: string, options?: { targetDir?: string; name?: string }): Promise<any>;
    moveAsset(path: string, target: string, selector?: AssetLibrarySelector): Promise<any>;
    readAssetFile(path: string, signal?: AbortSignal, selector?: AssetLibrarySelector): Promise<{ path: string; revision: string; content: Uint8Array }>;
    writeAssetFile(path: string, content: string | Uint8Array, revision?: string, selector?: AssetLibrarySelector): Promise<any>;
    removeAsset(path: string, selector?: AssetLibrarySelector, options?: { permanent?: boolean; force?: boolean }): Promise<any>;
    getAssetsDirectory(options?: { create?: boolean }): Promise<string>;
    assertAssetRelativePath(path: string): void;
    queryAssets(options: Record<string, unknown>): Promise<{ items: unknown[]; total: number; truncated: boolean }>;
  };
  readonly models: {
    getConfiguredModel(providerId: string, modelId: string): ConfiguredModel;
    providerSchema: { safeParse(value: unknown): { success: true; data: { models: readonly ProviderModel[] } } | { success: false; error: unknown } };
    getModelLimits(providerId: string, model: ProviderModel): { contextWindow: number; maxTokens: number };
    readAiReferences(directory: string | undefined, references: readonly AgentReference[], signal?: AbortSignal, provider?: { apiUrl: string; apiKey: string; protocol: string }): Promise<{ dataType: string; value: string }[]>;
    referenceContent(protocol: string, prompt: string, references: { dataType: string; value: string }[], referenceOffset?: number): object[];
    createFileTransport(provider: { apiUrl: string; apiKey: string; protocol: string }, options?: { fetch?: typeof fetch; signal?: AbortSignal }): { prepare(payload: unknown): Promise<void>; fetch: typeof fetch };
    FileRequestLimitError: new (excessBytes: number, excessCount: number, message?: string) => Error & { readonly excessBytes: number; readonly excessCount: number };
    getRequestFiles(payload: unknown): RequestFile[];
  };
  readonly personalization: {
    isMemoryEnabled(): boolean;
    readDocument(document: "memory" | "agents"): Promise<{ content: string; revision: string }>;
    saveDocument(document: "memory" | "agents", content: string, revision: string): Promise<any>;
    maxDocumentLength: number;
  };
  readonly teams: {
    readTeam(name: string): Promise<{ directory: string; manifest: TeamManifest; files: Map<string, Uint8Array>; enabled: boolean }>;
    saveTeamFile(name: string, path: string, content: string): Promise<unknown>;
    listTeams(): Promise<{ name: string; description: string; enabled: boolean; loadError: string; kind: "local" | "remote" }[]>;
    getRemoteTeam(name: string): { name: string; cardUrl: string; token?: string; enabled: boolean; card: { name: string; description: string; version: string } } | undefined;
  };
  readonly tools: {
    listTools(): Promise<any[]>;
    loadTool(name: string, directory?: string): Promise<any>;
    validateToolConfig(plugin: any, config: Record<string, unknown>): any;
  };
  readonly skills: {
    directory(): string;
    isEnabled(name: string): boolean;
  };
  readonly mcp: {
    callControl(connectionId: string, name: string, args: Record<string, unknown>, signal: AbortSignal, directory?: string): Promise<any>;
    getConnection(id?: string, directory?: string): McpConnection | undefined;
    getAppOrigin(request: AppOriginRequest): string;
    createMcpAgentTools(): Promise<any[]>;
  };
  readonly documents: {
    readDocument(name: string, bytes: Uint8Array, mimeType?: string): Promise<Buffer>;
  };
  readonly media: {
    listMediaModels(): Promise<any[]>;
    generateMedia(cwd: string, mediaType: "image" | "video" | "audio", request: any, signal?: AbortSignal): Promise<any[]>;
    createWorkspaceFfmpeg(cwd: string, signal?: AbortSignal): Promise<any>;
  };
  readonly browser: {
    createBrowserContext(cwd: string): any;
  };
  readonly i18n: {
    t(strings: TemplateStringsArray, ...values: unknown[]): string;
    translateMessage(message: string | { id: string; values?: Record<string, unknown> }, values?: Record<string, unknown>): string;
    translateError(error: unknown): string;
  };
  readonly platform: {
    getRuntimePlatform(): RuntimePlatform;
  };
};

let installed: AgentHost | null = null;

export function configureAgentHost(host: AgentHost): void {
  if (installed) throw new Error("AgentHost 已注入");
  installed = host;
}

export function getAgentHost(): AgentHost {
  if (!installed) throw new Error("AgentHost 未注入");
  return installed;
}
