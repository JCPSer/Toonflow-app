import type { AgentMention } from "./runtime/types";

export type MentionNode = { id: string; name: string; outputCount: number; available: boolean; dataType?: string; thumbnail?: { url: string; mimeType: string } };
export type MentionOutput = { id: string; name: string; dataType: string; preview: string; available: boolean; thumbnail?: { url: string; mimeType: string } };
export type MentionAsset = { path: string; name: string; type: "file" | "directory"; dataType?: string; preview?: string };
export type MentionPage<T> = { items: T[]; nextCursor?: string };
export type MentionCanvasNode = { id: string; type?: string; label?: unknown; data?: unknown };
import type { MentionQuery } from "@toonflow/formats/mentionSources";

export type { MentionQuery };
export type MentionCanvasSource = {
  currentCanvasId(): string;
  canvases(signal?: AbortSignal): Promise<{ id: string; name: string }[]>;
  nodes(canvasId: string, options: MentionQuery): Promise<MentionPage<MentionNode>> | undefined;
  outputs(canvasId: string, nodeId: string): MentionOutput[] | undefined;
  selectCanvas(canvasId: string, nodeId: string, outputId: string): Promise<AgentMention> | undefined;
  // ACT: 节点引用要读上游 textNode 的正文文件，因此允许异步；消费方本就 await。
  selectNode(canvasId: string, nodeId: string): Promise<AgentMention> | undefined;
};

export function mentionRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nodeData(node: MentionCanvasNode) {
  return mentionRecord(node.data) ? node.data : {};
}

export function mentionNodeName(node: MentionCanvasNode) {
  const label = nodeData(node).label ?? node.label;
  return (typeof label === "string" && label.trim() ? label : node.id).slice(0, 255);
}

export function mentionOutputValue(node: MentionCanvasNode, outputId: string) {
  const data = nodeData(node);
  const outputs = mentionRecord(data.outputs) ? data.outputs : {};
  const output = outputs[outputId];
  if (mentionRecord(output)) {
    const { dataType, value } = output;
    if ((dataType === "STRING" && typeof value === "string") || (dataType === "BOOLEAN" && typeof value === "boolean")
      || (dataType === "INT" && typeof value === "number" && Number.isSafeInteger(value))
      || (dataType === "FLOAT" && typeof value === "number" && Number.isFinite(value))) {
      return { dataType, value };
    }
    if (["IMAGE", "MASK", "VIDEO", "AUDIO", "FILE"].includes(String(dataType)) && mentionRecord(value)
      && typeof value.url === "string" && value.url.trim() && typeof value.mimeType === "string") {
      return { dataType: String(dataType), value: { url: value.url, mimeType: value.mimeType } };
    }
  }
  const handles = Array.isArray(data.handles) ? data.handles : [];
  const handle = handles.find(handle => mentionRecord(handle) && handle.id === outputId && handle.type === "source");
  const isText = mentionRecord(handle) && (Array.isArray(handle.dataType) ? handle.dataType : [handle.dataType]).includes("STRING");
  if (isText || (node.type === "remote-textNode" && outputId === "text")) {
    if (typeof data.textSnapshot === "string") return { dataType: "STRING", value: data.textSnapshot };
    if (typeof data.textPath === "string" && data.textPath) return { dataType: "STRING", textPath: data.textPath };
  }
}

export function mentionNodeOutputs(node: MentionCanvasNode): MentionOutput[] {
  const data = nodeData(node);
  const handles = Array.isArray(data.handles) ? data.handles : [];
  const names = new Map<string, { name: string; dataType: string }>();
  for (const handle of handles) {
    if (!mentionRecord(handle) || handle.type !== "source" || typeof handle.id !== "string") continue;
    names.set(handle.id, { name: typeof handle.label === "string" ? handle.label.slice(0, 160) : handle.id,
      dataType: String(Array.isArray(handle.dataType) ? handle.dataType[0] : handle.dataType ?? "") });
  }
  if (mentionRecord(data.outputs)) for (const id in data.outputs) {
    if (!Object.hasOwn(data.outputs, id) || id === "toJSON" || names.has(id)) continue;
    const output = data.outputs[id];
    if (mentionRecord(output)) names.set(id, { name: id, dataType: String(output.dataType ?? "") });
  }
  if (!names.size && node.type === "remote-textNode" && (data.textPath || data.textSnapshot)) names.set("text", { name: "文本输出", dataType: "STRING" });
  return [...names].map(([id, item]) => {
    const output = mentionOutputValue(node, id);
    const available = !!output && (output.textPath !== undefined || (typeof output.value === "string" ? !!output.value.length : output.value !== undefined));
    const preview = output?.textPath ? "文本内容" : mentionRecord(output?.value) ? String(output.value.url).slice(-160).split(/[\\/]/).pop() ?? ""
      : output?.value === undefined ? "暂无输出" : String(output.value).slice(0, 160);
    const media = output?.value;
    const thumbnail = output && ["IMAGE", "MASK", "VIDEO"].includes(output.dataType) && mentionRecord(media)
      && typeof media.url === "string" && media.url.length <= 4096 && typeof media.mimeType === "string" && media.mimeType.length <= 128
      ? { url: media.url, mimeType: media.mimeType } : undefined;
    return { id, ...item, dataType: output?.dataType ?? item.dataType, preview, available, ...(thumbnail ? { thumbnail } : {}) };
  });
}

export async function queryMentionNodes(nodes: readonly MentionCanvasNode[], revision: string, options: MentionQuery = {}): Promise<MentionPage<MentionNode>> {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  let offset = 0;
  if (options.cursor) {
    let cursor: unknown;
    try { cursor = JSON.parse(options.cursor); } catch { throw new Error("分页已失效，请重新搜索"); }
    if (!Array.isArray(cursor) || cursor[0] !== revision || cursor[1] !== query || !Number.isSafeInteger(cursor[2]) || cursor[2] < 0) throw new Error("分页已失效，请重新搜索");
    offset = cursor[2];
  }
  const items: MentionNode[] = [];
  const end = Math.min(nodes.length, offset + 2000);
  // ACT: 名称搜索每页最多扫描 2000 节点；不复制画布，不读输出正文，不为所有节点建立深响应对象。
  for (; offset < end && items.length < limit; offset++) {
    options.signal?.throwIfAborted();
    const node = nodes[offset];
    if (!node || typeof node.id !== "string") continue;
    const name = mentionNodeName(node);
    if (query && !`${node.id} ${name}`.toLocaleLowerCase().includes(query)) continue;
    const outputs = mentionNodeOutputs(node);
    const available = outputs.find(output => output.available);
    const media = outputs.find(output => output.thumbnail);
    const thumbnail = media?.thumbnail;
    items.push({ id: node.id, name, outputCount: outputs.length, available: !!available,
      dataType: (media ?? available ?? outputs[0])?.dataType, ...(thumbnail ? { thumbnail } : {}) });
  }
  return { items, ...(offset < nodes.length ? { nextCursor: JSON.stringify([revision, query, offset]) } : {}) };
}

/**
 * ACT: 引用只传指针，不发原文——文本给工作区路径由模型按需 read，
 * 媒体给路径 + mimeType。这样一次性把几万字的节点塞进上下文的问题从根上消失。
 * 校验与预览的正文由调用方在本地读取，不进入模型上下文。
 */
export async function createCanvasMention(node: MentionCanvasNode, canvasId: string, outputId: string): Promise<AgentMention> {
  const output = mentionNodeOutputs(node).find(output => output.id === outputId);
  const selected = mentionOutputValue(node, outputId);
  if (!output?.available || !selected) throw new Error("这个输出暂无内容，请重新选择");
  const canvasName = canvasId.replace(/\.json$/i, "").slice(0, 255);
  const nodeName = mentionNodeName(node);
  // 文本输出落盘在 textPath，直接给路径；没有路径但内存里有值时，说明是未落盘的临时输出，退回节点指针。
  const value = selected.textPath !== undefined ? { path: selected.textPath, mimeType: "text/markdown" } : selected.value;
  if (typeof value === "string" && !value.trim()) throw new Error("这个输出暂无内容，请重新选择");
  return { id: crypto.randomUUID(), label: `${nodeName} · ${output.name}`.slice(0, 500), source: { kind: "canvas", canvasId, canvasName, nodeId: node.id,
    nodeName, outputId, outputName: output.name }, dataType: selected.dataType, value };
}

export type MentionEdge = { source: string; sourceHandle: string; target: string; targetHandle: string };
export type MentionNodeUpstream = {
  targetHandle: string;
  targetHandleName?: string;
  nodeId: string;
  nodeName: string;
  nodeType?: string;
  outputId: string;
  outputName?: string;
  dataType: string;
  preview: string;
  path?: string;
  mimeType?: string;
};

const mediaDataTypes = new Set(["IMAGE", "MASK", "VIDEO", "AUDIO", "FILE"]);
const upstreamLimit = 20;
const previewLength = 200;

// ACT: 预览会拼进提示词，多行正文与超长文本必须压平截断，否则一条上游就能吃掉大段上下文。
function upstreamPreview(preview: string) {
  const flat = preview.replace(/\s+/g, " ").trim();
  return flat.length > previewLength ? `${flat.slice(0, previewLength)}…` : flat;
}

/** ACT: 媒体上游只给定位信息（路径 + mimeType），既不塞图片内容也不请求缩略图。 */
function mediaReference(dataType: string, value: unknown) {
  if (!mediaDataTypes.has(dataType) || !mentionRecord(value)) return {};
  const { url, mimeType } = value;
  if (typeof url !== "string" || !url.trim() || typeof mimeType !== "string" || !mimeType.trim()) return {};
  return { path: url.slice(0, 4096), mimeType: mimeType.slice(0, 128) };
}

function targetHandleName(node: MentionCanvasNode, handleId: string) {
  const handles = nodeData(node).handles;
  if (!Array.isArray(handles)) return undefined;
  const handle = handles.find(item => mentionRecord(item) && item.type === "target" && item.id === handleId);
  return mentionRecord(handle) && typeof handle.label === "string" && handle.label.trim() ? handle.label.slice(0, 160) : undefined;
}

/**
 * ACT: 节点引用只取一层入边，给模型「这个节点的输入来自哪里」的结构与短预览；
 * 完整内容仍要它自己用画布工具读，避免把整条上游链路的正文都塞进引用。
 */
export function collectUpstream(node: MentionCanvasNode, edges: readonly MentionEdge[] | undefined,
  nodesById: ReadonlyMap<string, MentionCanvasNode> | undefined,
  readText?: (path: string) => Promise<string>): Promise<{ upstream: MentionNodeUpstream[]; truncated?: boolean }> {
  if (!edges?.length) return Promise.resolve({ upstream: [] });
  // ACT: 悬空边（端点节点已删）与空端口边对模型没有意义，统一在这里过滤；实时与离线共用同一口径。
  const incoming = edges.filter(edge => edge.target === node.id && !!edge.sourceHandle && !!edge.targetHandle
    && (!nodesById || nodesById.has(edge.source)));
  const upstream = incoming.slice(0, upstreamLimit).map(async edge => {
    const source = nodesById?.get(edge.source);
    const output = source ? mentionNodeOutputs(source).find(item => item.id === edge.sourceHandle) : undefined;
    const selected = source ? mentionOutputValue(source, edge.sourceHandle) : undefined;
    const dataType = output?.dataType ?? "";
    const handleName = targetHandleName(node, edge.targetHandle);
    // ACT: 画布文件里 textNode 的 outputs 被 toJSON 清空，正文只剩 textPath；离线链路必须读文件才拿得到预览。
    let text = typeof selected?.value === "string" ? selected.value : undefined;
    if (text === undefined && typeof selected?.textPath === "string" && readText) text = await readText(selected.textPath).catch(() => undefined);
    // ACT: 正文读不到时不能只说「文本内容」，否则模型会把占位文案当成真实摘要直接用。
    const fallback = selected?.textPath !== undefined && text === undefined ? "文本内容（需用工具读取）" : output?.preview ?? "暂无输出";
    const item: MentionNodeUpstream = {
      targetHandle: edge.targetHandle.slice(0, 256),
      nodeId: edge.source.slice(0, 256),
      nodeName: (source ? mentionNodeName(source) : edge.source).slice(0, 255),
      outputId: edge.sourceHandle.slice(0, 256),
      dataType,
      // ACT: 列表预览只截到 160 字给 UI 用；这里按上游口径重新从完整值取，避免被列表截断限制。
      preview: upstreamPreview(text ?? fallback),
      ...(handleName ? { targetHandleName: handleName } : {}),
      ...(source?.type ? { nodeType: String(source.type).slice(0, 64) } : {}),
      ...(output?.name ? { outputName: output.name.slice(0, 160) } : {}),
      ...mediaReference(dataType, selected?.value),
    };
    return item;
  });
  return Promise.all(upstream).then(items => ({ upstream: items, ...(incoming.length > upstreamLimit ? { truncated: true } : {}) }));
}

// ACT: 节点引用带身份 + 直接上游摘要；value 从 null 换成对象后仍满足 mentions schema 的 isBoundedValue。
export async function createNodeMention(node: MentionCanvasNode, canvasId: string,
  context?: { edges?: readonly MentionEdge[]; nodesById?: ReadonlyMap<string, MentionCanvasNode>; readText?: (path: string) => Promise<string> }): Promise<AgentMention> {
  const canvasName = canvasId.replace(/\.json$/i, "").slice(0, 255);
  const nodeName = mentionNodeName(node);
  return { id: crypto.randomUUID(), label: nodeName, source: { kind: "canvas", canvasId, canvasName, nodeId: node.id, nodeName },
    dataType: "NODE", value: await collectUpstream(node, context?.edges, context?.nodesById, context?.readText) };
}

export { mentionAssetType } from "@toonflow/formats/mentionSources";
