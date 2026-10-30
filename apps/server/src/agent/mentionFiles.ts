import { open, opendir, readFile, stat } from "@toonflow/file";
import { basename } from "node:path";
import { getAgentHost } from "@/agent/host";
import { createCanvasMention, createNodeMention, mentionAssetType, mentionNodeDisabled, mentionNodeOutputs, mentionRecord, queryMentionNodes,
  type MentionCanvasNode, type MentionEdge, type MentionQuery } from "./mentionSources";
import type { AgentMention } from "./runtime/types";
import { decodeTextFile } from "@toonflow/formats/documentFormats";

export function queryMentionAssets(options: Record<string, unknown>) {
  return getAgentHost().assets.queryAssets(options);
}

type StoredCanvas = { revision: string; nodes: MentionCanvasNode[]; byId: Map<string, MentionCanvasNode>; edges: MentionEdge[] };
const canvasCache = new Map<string, { revision: string; bytes: number; value: Promise<StoredCanvas> }>();

async function readMentionText(directory: string, relativePath: string) {
  const { path } = await getAgentHost().workspace.resolveWorkspacePath(directory, relativePath);
  const info = await stat(path);
  if (!info.isFile() || info.size > 400000) throw Object.assign(new Error("文本引用最多支持 100000 个字符，请缩小内容后重试"), { status: 400 });
  const bytes = await readFile(path);
  if (bytes.byteLength > 400000) throw Object.assign(new Error("文本引用最多支持 100000 个字符，请缩小内容后重试"), { status: 400 });
  const text = decodeTextFile(bytes);
  if (text.length > 100000) throw Object.assign(new Error("文本引用最多支持 100000 个字符，请缩小内容后重试"), { status: 400 });
  return text;
}

async function readCanvas(directory: string, canvasId: string) {
  const { path } = await getAgentHost().workspace.resolveWorkspacePath(directory, canvasId);
  const info = await stat(path);
  if (!info.isFile() || info.size > 256 * 1024 * 1024) throw Object.assign(new Error("画布文件无效或超过 256 MB 的读取上限"), { status: 400 });
  const revision = `${info.mtimeMs}:${info.size}`;
  const cached = canvasCache.get(path);
  if (cached?.revision === revision) {
    canvasCache.delete(path);
    canvasCache.set(path, cached);
    return cached.value;
  }
  const value = (async () => {
    const canvas: unknown = JSON.parse(await readFile(path, "utf8"));
    const latest = await stat(path);
    if (latest.mtimeMs !== info.mtimeMs || latest.size !== info.size) throw Object.assign(new Error("画布正在保存，请重试"), { status: 409 });
    if (!mentionRecord(canvas) || canvas.toonflowCanvas !== true || !Array.isArray(canvas.nodes)) throw Object.assign(new Error("文件不是有效画布"), { status: 400 });
    const nodes = canvas.nodes.filter((node): node is MentionCanvasNode => mentionRecord(node) && typeof node.id === "string");
    // ACT: 连线与节点同在画布 JSON 里；手写或旧文件可能没有 edges，非法时按无连线处理而不是让引用失败。
    const edges = Array.isArray(canvas.edges) ? canvas.edges.filter((edge): edge is MentionEdge => mentionRecord(edge)
      && typeof edge.source === "string" && typeof edge.sourceHandle === "string"
      && typeof edge.target === "string" && typeof edge.targetHandle === "string") : [];
    return { revision, nodes, byId: new Map(nodes.map(node => [node.id, node])), edges };
  })();
  const entry = { revision, bytes: info.size, value };
  canvasCache.set(path, entry);
  // ACT: 离线画布仅在服务端解析；最多缓存两份、源文件合计 256 MB，每次查询重新核对 mtime/size。
  while (canvasCache.size > 2 || [...canvasCache.values()].reduce((total, entry) => total + entry.bytes, 0) > 256 * 1024 * 1024) {
    canvasCache.delete(canvasCache.keys().next().value!);
  }
  void value.catch(() => { if (canvasCache.get(path) === entry) canvasCache.delete(path); });
  return value;
}

export async function listMentionCanvases(directory: string, signal: AbortSignal) {
  const canvases: { id: string; name: string }[] = [];
  const folders = [""];
  for (const folder of folders) {
    signal.throwIfAborted();
    const resolved = await getAgentHost().workspace.resolveWorkspacePath(directory, folder);
    const entries = await opendir(resolved.path);
    for await (const entry of entries) {
      signal.throwIfAborted();
      const relativePath = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // ACT: 素材库与项目内部目录不参与画布列举，避免把库内 JSON 当成画布。
        const name = entry.name.toLocaleLowerCase();
        if (!["assets", "library", "library-assets", ".library", ".trash", ".thumbs", ".agent", ".toonflow"].includes(name) && !entry.name.startsWith(".toonflowCopy")) folders.push(relativePath);
        continue;
      }
      if (!entry.isFile() || !/\.json$/i.test(entry.name)) continue;
      const { path } = await getAgentHost().workspace.resolveWorkspacePath(directory, relativePath);
      const file = await open(path, "r");
      try {
        const header = Buffer.alloc(4096);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        if (/^\s*\{/.test(header.toString("utf8", 0, bytesRead)) && /"toonflowCanvas"\s*:\s*true\s*[,}]/.test(header.toString("utf8", 0, bytesRead))) {
          canvases.push({ id: relativePath, name: relativePath.slice(0, -5) });
        }
      } finally { await file.close(); }
    }
  }
  return canvases.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true }));
}

export async function queryStoredMentionNodes(directory: string, canvasId: string, options: MentionQuery) {
  options.signal?.throwIfAborted();
  const canvas = await readCanvas(directory, canvasId);
  options.signal?.throwIfAborted();
  // ACT: 传完整节点表，禁用过滤交给 queryMentionNodes —— 它的分页 revision 含禁用签名，
  // 预过滤会让签名只反映可见节点数，一禁一解时签名不变导致游标失效。
  return queryMentionNodes(canvas.nodes, `${canvasId}:${canvas.revision}`, options);
}

/** 显式按 ID 命中禁用节点时要报「已禁用」而不是「已删除」，两者对用户的后续操作不同。 */
function assertMentionNodeEnabled(node: MentionCanvasNode) {
  if (mentionNodeDisabled(node)) throw Object.assign(new Error(`节点已禁用：${node.id}`), { status: 403 });
}

export async function storedMentionOutput(directory: string, canvasId: string, nodeId: string, outputId?: string) {
  const canvas = await readCanvas(directory, canvasId);
  const node = canvas.byId.get(nodeId);
  if (!node) throw Object.assign(new Error("节点已删除，请重新选择"), { status: 404 });
  assertMentionNodeEnabled(node);
  // ACT: 文本输出引用要带正文摘要，离线链路只能靠工作区文件读，口径与节点引用一致。
  return outputId === undefined ? mentionNodeOutputs(node)
    : createCanvasMention(node, canvasId, outputId, { readText: path => readMentionText(directory, path) });
}

export async function storedNodeMention(directory: string, canvasId: string, nodeId: string) {
  const canvas = await readCanvas(directory, canvasId);
  const node = canvas.byId.get(nodeId);
  if (!node) throw Object.assign(new Error("节点已删除，请重新选择"), { status: 404 });
  assertMentionNodeEnabled(node);
  // ACT: readText 让上游 textNode 的预览能取到正文（画布里 outputs 已被 toJSON 清空，只剩 textPath）。
  return createNodeMention(node, canvasId, {
    edges: canvas.edges, nodesById: canvas.byId, readText: path => readMentionText(directory, path),
    extraValue: () => agentNodeMention(directory, node),
  });
}

const agentNodeTypePattern = /^(?:remote-)?agentNode$/;
/** 会话文件里出现过的媒体/文档路径；只做字符串候选，命中后必须能在工作区里 stat 到才算数。 */
const agentFilePattern = /"([^"\n]{2,300}\.(?:png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|mkv|mp3|wav|m4a|flac|ogg|md|txt|json|jsonl|csv|srt|vtt|pdf))"/gi;
const agentFileLimit = 50;

function sessionSummary(text: string) {
  const messages: { role: string; text: string }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
      if (entry.type !== "message" || !entry.message || typeof entry.message.role !== "string") continue;
      if (entry.message.role !== "assistant") continue;
      const content = entry.message.content;
      const parts = Array.isArray(content) ? content : [];
      const joined = parts.map(part => (part && typeof part === "object" && (part as { type?: string }).type === "text"
        ? String((part as { text?: string }).text ?? "") : "")).join("").trim();
      if (joined) messages.push({ role: entry.message.role, text: joined });
    } catch {
      // ACT: 会话文件是追加写的，末尾可能截断；坏行直接跳过，不影响整体摘要。
    }
  }
  const last = messages.at(-1);
  return last ? last.text.slice(-800) : "";
}

/**
 * Agent 节点的引用内容：最近一轮回复摘要 + 该会话里出现过且仍存在的文件索引。
 * ACT: 只给路径与大小，正文仍由模型按需 read；索引来自会话文本里命中且能 stat 到的候选，
 * 不做"猜目录"式的递归扫描。
 */
async function agentNodeMention(directory: string, node: MentionCanvasNode) {
  if (!agentNodeTypePattern.test(String(node.type ?? ""))) return undefined;
  const data = mentionRecord(node.data) ? node.data : {};
  const sessionFile = typeof data.agentSessionFile === "string" ? data.agentSessionFile : "";
  if (!/^[\w-]+\.jsonl$/.test(sessionFile)) return { agent: { sessionFile: null, summary: "", files: [], note: "该 Agent 节点还没有会话记录" } };
  let text: string;
  try {
    const { path } = await getAgentHost().workspace.resolveWorkspacePath(directory, `.agent/sessions/${sessionFile}`);
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    // ACT: 会话可能很长；只读末尾 2 MB，摘要与文件索引都只依赖近期内容。
    const start = Math.max(0, info.size - 2 * 1024 * 1024);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(info.size - start);
      await handle.read(buffer, 0, buffer.length, start);
      text = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return { agent: { sessionFile, summary: "", files: [], note: "会话文件不可读，可能是旧会话或已被移动" } };
  }
  const seen = new Set<string>();
  const files: { path: string; size: number; extension: string }[] = [];
  for (const match of text.matchAll(agentFilePattern)) {
    if (files.length >= agentFileLimit) break;
    const raw = String(match[1]).replace(/^\.\//, "").replace(/\/+/g, "/");
    if (!raw || seen.has(raw) || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) continue;
    seen.add(raw);
    const resolved = await getAgentHost().workspace.resolveWorkspacePath(directory, raw).catch(() => undefined);
    if (!resolved) continue;
    const info = await stat(resolved.path).catch(() => undefined);
    if (!info?.isFile()) continue;
    files.push({ path: raw, size: info.size, extension: raw.split(".").pop()!.toLowerCase() });
  }
  return { agent: { sessionFile, summary: sessionSummary(text), files } };
}

export async function selectMentionAsset(relativePath: string, options: { library?: "global" | "project"; directory?: string } = {}): Promise<AgentMention> {
  const library = options.library ?? "global";
  if (library === "project" && !options.directory) throw Object.assign(new Error("项目素材库必须提供工作区目录"), { status: 400 });
  const root = library === "project"
    ? (await getAgentHost().assets.openAssetLibrary({ library: "project", directory: options.directory })).root
    : await getAgentHost().assets.getAssetsDirectory();
  getAgentHost().assets.assertAssetRelativePath(relativePath);
  const { path } = await getAgentHost().workspace.resolveWorkspacePath(root, relativePath);
  const info = await stat(path);
  const type = mentionAssetType(relativePath);
  if (!info.isFile() || !info.size || info.size > 100 * 1024 * 1024) throw Object.assign(new Error("请选择非空且不超过 100 MB 的素材文件"), { status: 400 });
  // ACT: 不读正文，只给库内相对路径；文本由模型用 read 按需读取。
  const value = type.dataType === "STRING" ? { path: relativePath, mimeType: type.mimeType } : { url: relativePath, mimeType: type.mimeType };
  return { id: crypto.randomUUID(), label: basename(path), source: { kind: "asset", path: relativePath, library }, dataType: type.dataType, value };
}
