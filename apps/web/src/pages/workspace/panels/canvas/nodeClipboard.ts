import type { Edge, GraphEdge, GraphNode, Node } from "@vue-flow/core";
import { isNodeOutput } from "@toonflow/nodes-scaffold/values";
import { writeClipboardText } from "@/lib/clipboard";
import { transferWorkspaceFiles } from "@/lib/workspaceFiles";

export const nodeClipboardCommand = /^toonflow:paste-node:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ClipboardNode = { type: string; data: Record<string, unknown> };
type ClipboardEntry = { command: string; directory: string; node?: ClipboardNode; nodes?: Node[]; edges?: Edge[] };

async function openClipboardDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("toonflow.nodeClipboard", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("nodes");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function accessClipboard(entry?: ClipboardEntry) {
  const database = await openClipboardDatabase();
  try {
    return await new Promise<ClipboardEntry | undefined>((resolve, reject) => {
      const transaction = database.transaction("nodes", entry ? "readwrite" : "readonly");
      const store = transaction.objectStore("nodes");
      // ACT: 只保留最近一次快照；旧命令失效，不累计复制历史。
      const request = entry ? store.put(entry, "latest") : store.get("latest");
      transaction.oncomplete = () => resolve(entry ?? request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error("节点剪贴数据读写失败"));
    });
  } finally {
    database.close();
  }
}

export function copyNodeToClipboard(node: Pick<Node, "type" | "data">, directory: string) {
  return copyNodesToClipboard([{ ...node, id: crypto.randomUUID(), position: { x: 0, y: 0 } }], [], directory);
}

export async function copyNodesToClipboard(nodes: Node[], edges: Edge[], directory: string) {
  if (!directory) throw new Error("请先打开项目");
  if (!nodes.length || nodes.some(node => !node.type)) throw new Error("节点类型无效");
  const command = `toonflow:paste-node:${crypto.randomUUID()}`;
  const ids = new Set(nodes.map(node => node.id));
  // ACT: 与画布序列化一样移除运行态字段，保留分组、尺寸及节点自定义持久配置。
  const snapshot = JSON.parse(JSON.stringify({
    nodes: nodes.map(node => {
      const { computedPosition, handleBounds, selected, dimensions, isParent, resizing, dragging, events, initialized, ...saved } = node as GraphNode & { initialized?: boolean };
      return { ...saved, data: saved.data ?? {} };
    }),
    edges: edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => {
      const { selected, sourceNode, targetNode, sourceX, sourceY, targetX, targetY, events, ...saved } = edge as GraphEdge;
      return saved;
    }),
  })) as { nodes: Node[]; edges: Edge[] };
  await accessClipboard({ command, directory, ...snapshot });
  await writeClipboardText(command);
}

export async function readClipboardNodes(command: string, directory: string, validate?: (nodes: Node[]) => void) {
  if (!nodeClipboardCommand.test(command)) return;
  const entry = await accessClipboard();
  if (!entry || entry.command !== command) throw new Error("节点剪贴数据已失效，请重新复制");
  const nodes = entry.nodes ?? (entry.node ? [{ ...entry.node, id: "clipboardNode", position: { x: 0, y: 0 } }] : undefined);
  const edges = entry.edges ?? [];
  if (!Array.isArray(nodes) || !nodes.length || !Array.isArray(edges) || nodes.some(node => !node
    || typeof node.id !== "string" || !node.id || typeof node.type !== "string" || !node.type
    || !node.data || typeof node.data !== "object" || Array.isArray(node.data)
    || !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)
    || (node.parentNode !== undefined && (typeof node.parentNode !== "string" || node.parentNode === node.id)))) {
    throw new Error("节点剪贴数据格式错误，请重新复制");
  }
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length || nodes.some(node => node.parentNode !== undefined && !ids.has(node.parentNode))
    || edges.some(edge => !edge || typeof edge.id !== "string" || !edge.id || !ids.has(edge.source) || !ids.has(edge.target)
      || (edge.sourceHandle != null && typeof edge.sourceHandle !== "string")
      || (edge.targetHandle != null && typeof edge.targetHandle !== "string"))
    || new Set(edges.map(edge => edge.id)).size !== edges.length) {
    throw new Error("节点剪贴数据格式错误，请重新复制");
  }
  const parents = new Map(nodes.map(node => [node.id, node.parentNode]));
  const checked = new Set<string>();
  for (const node of nodes) {
    const path = new Set<string>();
    let id: string | undefined = node.id;
    while (id && !checked.has(id)) {
      if (path.has(id)) throw new Error("节点剪贴数据格式错误，请重新复制");
      path.add(id);
      id = parents.get(id);
    }
    path.forEach(id => checked.add(id));
  }
  // ACT: 先让调用方校验节点是否可用，再搬文件——否则安装插件都会失败的粘贴会先往目标项目里留一堆孤儿素材。
  validate?.(nodes);
  const transfers = await transferNodeFiles(nodes, entry.directory, directory);
  return { nodes, edges, transfers };
}

type MediaValue = { url: string; mimeType?: string };
type OutputNode = { data: { outputs?: Record<string, unknown> } & Record<string, unknown> };

/** url 是工作区相对路径（不是 http/blob/data 等可直接使用的地址）。 */
function isWorkspaceUrl(url: unknown): url is string {
  return typeof url === "string" && !!url && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url);
}

function forEachOutput(node: Node, visit: (value: MediaValue) => void) {
  const outputs = (node as unknown as OutputNode).data?.outputs;
  if (!outputs || typeof outputs !== "object") return;
  for (const output of Object.values(outputs)) {
    if (!isNodeOutput(output) || typeof output.value !== "object") continue;
    visit(output.value as MediaValue);
  }
}

/**
 * 跨项目粘贴时把节点引用的工作区文件搬到目标项目，并把 url 改写为搬迁后的路径。
 * ACT: 同项目粘贴不动文件；源项目已删除/不可读时报可读错误，交给调用方提示。
 */
async function transferNodeFiles(nodes: Node[], sourceDirectory: string | undefined, directory: string) {
  const urls = new Set<string>();
  for (const node of nodes) forEachOutput(node, value => { if (isWorkspaceUrl(value.url)) urls.add(value.url); });
  if (!urls.size || sourceDirectory === directory) return;
  if (!sourceDirectory) throw new Error("节点剪贴数据缺少工作目录，请重新复制");
  let result;
  try {
    result = await transferWorkspaceFiles(sourceDirectory, directory, [...urls]);
  } catch (error) {
    const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
    throw new Error(message ? `复制节点引用的文件失败：${message}` : "复制节点引用的文件失败，请确认源项目文件夹可访问后重试");
  }
  const mapping = new Map(result.files.filter(file => file.action === "copied").map(file => [file.source, file.target]));
  for (const node of nodes) forEachOutput(node, value => { if (isWorkspaceUrl(value.url)) value.url = mapping.get(value.url) ?? value.url; });
  // ACT: 裁剪/翻转的「恢复上一张」记录指向源项目的文件路径，跨项目后一律作废；
  // 否则点「恢复」会把节点指到一个在目标项目里不存在的图。
  for (const node of nodes) {
    const data = (node as unknown as { data?: { crop?: unknown } }).data;
    if (data && "crop" in data) delete data.crop;
  }
  // ACT: 素材库等应用管理目录不参与搬运，与"源文件已删除/复制失败"一样只能保留原引用，一起提示。
  const unavailable = result.missing.length + result.skipped.length + result.failed.length;
  return { copied: mapping.size, unavailable };
}
