import { getLocale, t, validationOptions } from "@/lib/i18n";
import { z } from "zod";
import { toolNameSchema } from "@toonflow/tools-scaffold/runtime";
import { mediaModelsSchema, mediaProviderFileSchema } from "@/modules/mediaGeneration/media/provider";
import { getAppRequestHeaders, getMcpRuntime } from "@/modules/mcpIntegration/mcp/runtime";

const maxBytes = 20 * 1024 * 1024;
const assetMaxBytes = 100 * 1024 * 1024;
const directory = z.string().min(1).max(4096);
const optionalDirectory = directory.optional();
const assetLibrary = z.enum(["global", "project"]).optional();
const path = z.string().min(1).max(4096);
const pluginName = z.string().regex(/^[a-z][a-zA-Z0-9]*$/);
const skillName = z.string().min(1).max(1024);
const skillPath = z.string().min(1).max(1024);
const sessionFile = z.string().regex(/^[\w-]+\.jsonl$/);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const base64 = z.string().max(Math.ceil(maxBytes / 3) * 4).base64();
const assetBase64 = z.string().max(Math.ceil(assetMaxBytes / 3) * 4).base64();
const sourceFields = {
  source: z.string().min(1).max(maxBytes).optional(),
  url: z.url().max(4096).optional(),
  force: z.boolean().optional(),
};
const sourceRequired = (value: { fileName?: string; source?: string; url?: string }) =>
  value.url ? value.source === undefined : value.fileName !== undefined && value.source !== undefined;

export const appOperations: {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  parameters: z.ZodType;
  refresh?: { type: "node" | "tool" | "skill" | "provider"; nameField?: string };
}[] = [
  {
    name: "listNodes", description: "列出已安装节点的元数据、说明和启用状态。", method: "GET", path: "/api/nodes/get", parameters: z.strictObject({}),
  },
  {
    name: "setNodeEnabled", description: "启用或禁用已安装节点。", method: "PUT", path: "/api/nodes/setEnabled",
    parameters: z.strictObject({ name: pluginName, enabled: z.boolean() }), refresh: { type: "node", nameField: "name" },
  },
  {
    name: "installNode", description: "通过 fileName/source 安装节点 UMD，或使用 url 下载；force 显式允许覆盖。下载和版本检查沿用现有安装接口。", method: "POST", path: "/api/nodes/install",
    parameters: z.strictObject({ ...sourceFields, fileName: z.string().max(128).optional() }).refine(sourceRequired, "提供 url 或 fileName/source，不能同时提供 url 和 source"), refresh: { type: "node" },
  },
  {
    name: "uninstallNode", description: "卸载指定节点插件，不删除工作区的画布和节点输出。", method: "DELETE", path: "/api/nodes/uninstall",
    parameters: z.strictObject({ name: pluginName }), refresh: { type: "node", nameField: "name" },
  },
  {
    name: "listTools", description: "列出已安装工具、说明、启用状态和配置。访问凭证由 MCP 输出统一脱敏。", method: "GET", path: "/api/tools/get", parameters: z.strictObject({}),
  },
  {
    name: "setToolEnabled", description: "启用或禁用工具；启用时沿用工具配置校验。", method: "PUT", path: "/api/tools/setEnabled",
    parameters: z.strictObject({ name: toolNameSchema, enabled: z.boolean() }), refresh: { type: "tool", nameField: "name" },
  },
  {
    name: "saveToolConfig", description: "保存指定工具的完整 config，按该工具的配置规则校验。不要回写脱敏占位符。", method: "PUT", path: "/api/tools/save",
    parameters: z.strictObject({ name: toolNameSchema, config: z.record(z.string(), z.json()) }), refresh: { type: "tool", nameField: "name" },
  },
  {
    name: "installTool", description: "通过 fileName/source 安装 .tool.js，或使用 url 下载；force 显式允许覆盖。", method: "POST", path: "/api/tools/install",
    parameters: z.strictObject({ ...sourceFields, fileName: z.string().max(104).regex(/^[a-z][a-zA-Z0-9]*\.tool\.js$/).optional() }).refine(sourceRequired, "提供 url 或 fileName/source，不能同时提供 url 和 source"), refresh: { type: "tool" },
  },
  {
    name: "uninstallTool", description: "卸载指定工具并删除其配置。", method: "DELETE", path: "/api/tools/uninstall",
    parameters: z.strictObject({ name: toolNameSchema }), refresh: { type: "tool", nameField: "name" },
  },
  {
    name: "listSkills", description: "列出全局已安装技能的元数据；工作区技能复用 skillOperator 工具。", method: "GET", path: "/api/skills/get", parameters: z.strictObject({}),
  },
  {
    name: "listSkillFiles", description: "列出指定全局技能的文件及主文件路径。", method: "GET", path: "/api/skills/list", parameters: z.strictObject({ name: skillName }),
  },
  {
    name: "readSkillFile", description: "读取指定全局技能的 UTF-8 文件；省略 path 时读取主 SKILL.md。", method: "GET", path: "/api/skills/read",
    parameters: z.strictObject({ name: skillName, path: skillPath.optional() }),
  },
  {
    name: "createSkillFile", description: "在已安装技能内新建空白文件，不覆盖已有文件；新技能请使用 installSkill 或 skillOperator。", method: "POST", path: "/api/skills/create",
    parameters: z.strictObject({ name: skillName, path: skillPath }), refresh: { type: "skill", nameField: "name" },
  },
  {
    name: "saveSkillFile", description: "保存已有技能文件；主 SKILL.md 必须保留相同的 frontmatter name 和有效 description。", method: "PUT", path: "/api/skills/save",
    parameters: z.strictObject({ name: skillName, path: skillPath.optional(), content: z.string().max(maxBytes) }), refresh: { type: "skill", nameField: "name" },
  },
  {
    name: "moveSkillFile", description: "在指定技能内移动或重命名文件，不覆盖已有目标。", method: "PUT", path: "/api/skills/move",
    parameters: z.strictObject({ name: skillName, path: skillPath, target: skillPath }), refresh: { type: "skill", nameField: "name" },
  },
  {
    name: "installSkill", description: "使用 fileName/base64 安装技能文件或压缩包，或使用 url 下载；force 显式允许覆盖。", method: "POST", path: "/api/skills/install",
    parameters: z.strictObject({ fileName: z.string().max(128).optional(), base64: base64.min(1).optional(), url: z.url().max(4096).optional(), force: z.boolean().optional() })
      .refine(value => value.url ? value.base64 === undefined : value.fileName !== undefined && value.base64 !== undefined, "提供 url 或 fileName/base64，不能同时提供 url 和 base64"), refresh: { type: "skill" },
  },
  {
    name: "uninstallSkill", description: "卸载全局技能及其文件，不影响工作区内的同名技能。", method: "DELETE", path: "/api/skills/uninstall",
    parameters: z.strictObject({ name: skillName }), refresh: { type: "skill", nameField: "name" },
  },
  {
    name: "listMediaProviders", description: "读取媒体供应商及预置 models、配置 revision；保存与删除时使用最新 revision。", method: "GET", path: "/api/providers/media/list", parameters: z.strictObject({}),
  },
  {
    name: "addMediaProvider", description: "从完整 TypeScript source 添加媒体供应商，沿用现有供应商结构检查。", method: "POST", path: "/api/providers/media/add",
    parameters: z.strictObject({ source: z.string().min(1).max(2 * 1024 * 1024) }), refresh: { type: "provider" },
  },
  {
    name: "saveMediaProviderModels", description: "修改供应商 TS 中的 models；revision 不匹配时拒绝覆盖。API Key 等凭证通过 updateSettings 配置。", method: "PUT", path: "/api/providers/media/save",
    parameters: z.strictObject({ fileName: mediaProviderFileSchema, models: mediaModelsSchema, revision }), refresh: { type: "provider", nameField: "fileName" },
  },
  {
    name: "deleteMediaProvider", description: "删除指定媒体供应商及其保存的配置；必须提供当前 revision。", method: "DELETE", path: "/api/providers/media/delete",
    parameters: z.strictObject({ fileName: mediaProviderFileSchema, revision }), refresh: { type: "provider", nameField: "fileName" },
  },
  {
    name: "listAssets", description: "列出素材库内容；不带参数时保留旧的全局库根目录一层结构（已弃用），传入 library/path/cursor/limit 等参数时分页返回。library=global（默认）为跨项目全局库，library=project 需同时提供 directory。", method: "GET", path: "/api/assets/list",
    parameters: z.strictObject({ library: assetLibrary, directory: optionalDirectory, path: path.optional(),
      query: z.string().max(500).optional(), cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(200).optional() }),
  },
  {
    name: "createAssetDirectory", description: "在素材库创建文件夹，path 为库内相对路径；library/directory 含义同 listAssets。", method: "POST", path: "/api/assets/mkdir",
    parameters: z.strictObject({ path, library: assetLibrary, directory: optionalDirectory }),
  },
  {
    name: "renameAsset", description: "在素材库移动或重命名文件、文件夹，不覆盖已有目标；library/directory 含义同 listAssets。", method: "POST", path: "/api/assets/rename",
    parameters: z.strictObject({ path, target: path, library: assetLibrary, directory: optionalDirectory }),
  },
  {
    name: "removeAsset", description: "把素材移入回收站（默认）或 permanent 彻底删除；被画布引用时返回引用列表，force 可强制删除。", method: "DELETE", path: "/api/assets/remove",
    parameters: z.strictObject({ path, permanent: z.boolean().optional(), force: z.boolean().optional(), library: assetLibrary, directory: optionalDirectory }),
  },
  {
    name: "readAsset", description: "读取不超过 100 MB 的素材文件，返回 base64 和 MIME 类型；library/directory 含义同 listAssets。", method: "GET", path: "/api/assets/read",
    parameters: z.strictObject({ path, library: assetLibrary, directory: optionalDirectory }),
  },
  {
    name: "saveAsset", description: "以 base64 上传不超过 100 MB 的文件到素材库（客户端→库）；默认不覆盖已有文件，父文件夹须存在。工作区内的现成文件请用 collectAsset 直接复制。", method: "PUT", path: "/api/assets/save",
    parameters: z.strictObject({ path, base64: assetBase64, library: assetLibrary, directory: optionalDirectory }),
  },
  {
    name: "collectAsset", description: "把当前工作区文件直接复制进素材库（工作区→库），不改源文件，重名自动追加 (2)；与 import/readAsset 的库→工作区方向相反。", method: "POST", path: "/api/assets/import",
    parameters: z.strictObject({ path, library: assetLibrary, directory: optionalDirectory,
      targetDir: z.string().max(4096).optional(), name: z.string().min(1).max(255).optional() }),
  },
  {
    name: "listAgentSessions", description: "列出目标工作区的内置 Agent 历史对话。directory 由 target.directory 注入。", method: "GET", path: "/api/agent/list", parameters: z.strictObject({ directory }),
  },
  {
    name: "createAgentSession", description: "在目标工作区创建新的内置 Agent 对话，不启动生成。directory 由 target.directory 注入。", method: "POST", path: "/api/agent/create", parameters: z.strictObject({ directory }),
  },
  {
    name: "getAgentSession", description: "读取内置 Agent 对话历史，sessionFile 来自 listAgentSessions。directory 由 target.directory 注入。", method: "GET", path: "/api/agent/get", parameters: z.strictObject({ directory, sessionFile }),
  },
  {
    name: "renameAgentSession", description: "修改内置 Agent 对话名称；directory 由 target.directory 注入。", method: "PATCH", path: "/api/agent/rename", parameters: z.strictObject({ directory, sessionFile, name: z.string().trim().min(1).max(80) }),
  },
];

export async function runAppOperation(name: string, parameters: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  const operation = appOperations.find(item => item.name === name);
  if (!operation) throw new Error(t`未知应用操作：${name}`);
  const args = operation.parameters.parse(parameters, validationOptions()) as Record<string, unknown>;
  const origin = getMcpRuntime().appOrigin;
  if (!origin) throw new Error("Toonflow 服务尚未就绪");
  const url = new URL(operation.path, origin);
  const headers: Record<string, string> = { ...getAppRequestHeaders(), "x-toonflow-workspace": "1", Origin: origin, Referer: `${origin}/`, "Accept-Language": getLocale() };
  let body: string | ArrayBuffer | undefined;
  if (operation.name === "saveAsset") {
    url.searchParams.set("path", args.path as string);
    for (const key of ["library", "directory"]) if (typeof args[key] === "string") url.searchParams.set(key, args[key] as string);
    body = new Uint8Array(Buffer.from(args.base64 as string, "base64")).buffer;
    if (body.byteLength > assetMaxBytes) throw new Error("素材文件不能超过 100 MB");
    headers["Content-Type"] = "application/octet-stream";
  } else if (operation.name === "collectAsset") {
    body = JSON.stringify({ library: args.library, directory: args.directory, targetDir: args.targetDir, name: args.name,
      source: { kind: "workspace", path: args.path } });
    headers["Content-Type"] = "application/json";
  } else if (operation.method === "GET") {
    for (const [key, value] of Object.entries(args)) if (value !== undefined) url.searchParams.set(key, String(value));
  } else {
    body = JSON.stringify(args, (_key, value) => {
      if (value === "[REDACTED]") throw new Error("不能保存脱敏占位符，请填写实际值");
      return value;
    });
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url, { method: operation.method, headers, body, signal, redirect: "error" });
  if (operation.name === "readAsset" && response.ok) {
    if (Number(response.headers.get("content-length")) > assetMaxBytes) {
      await response.body?.cancel();
      throw new Error("素材文件不能超过 100 MB");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > assetMaxBytes) throw new Error("素材文件不能超过 100 MB");
    return { path: args.path, mimeType: response.headers.get("content-type"), base64: bytes.toString("base64") };
  }
  const result = await response.json() as { code?: number; data?: unknown; message?: string };
  if (!response.ok || result.code !== 200) throw new Error(result.message || t`应用操作失败（${response.status}）`);
  return result.data ?? null;
}
