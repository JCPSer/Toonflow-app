import type { GraphNode, VueFlowStore } from "@vue-flow/core";
import type { NodeData } from "@toonflow/nodes-scaffold/connection";
import { isNodeOutput, type NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import { importAsset, toAssetError } from "../assetLibrary/api";
import { getSelectionRoots } from "./selectionNodes";

/** 可入库的产物：内置节点的图片/视频输出都只有 url + mimeType。 */
export type AssetSource = { dataType: "IMAGE" | "VIDEO"; value: NodeMediaValue };

export type SaveSelectionToAssetsResult = {
  saved: number;
  failed: { label: string; reason: string }[];
  renamed: number;
};

const mediaTypes = new Set(["IMAGE", "VIDEO"]);
const preferredHandleIds = ["image", "video"];
// ACT: 与 useAssetUpload 一致；并发 2 足够让写盘与索引刷新重叠，又不会把素材接口拖死。
const concurrency = 2;
const maxAttempts = 3;
const maxNameLength = 200;

const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
};

function nodeData(node: GraphNode): NodeData {
  return (node.data ?? {}) as NodeData;
}

/** handle.dataType 允许字符串、字符串数组或逗号分隔，统一拆成类型名列表。 */
function handleDataTypes(dataType: unknown): string[] {
  const list = typeof dataType === "string" ? dataType.split(",") : Array.isArray(dataType) ? dataType : [];
  return list.flatMap(item => typeof item === "string" ? item.split(",") : []).map(item => item.trim()).filter(Boolean);
}

function readMediaOutput(node: GraphNode, handleId: string) {
  const output = nodeData(node).outputs?.[handleId];
  if (!isNodeOutput(output)) return undefined;
  if (output.dataType !== "IMAGE" && output.dataType !== "VIDEO") return undefined;
  return { dataType: output.dataType, value: output.value } satisfies AssetSource;
}

/**
 * 取节点的当前媒体产物：优先 handle id 为 image / video 的 source 输出，
 * 否则按 handles 里 source 的顺序取第一个有值的图片/视频输出（内置节点只有一个，等价于「当前展示」）。
 */
export function getAssetSource(node: GraphNode): AssetSource | undefined {
  const handles = nodeData(node).handles;
  const sources = (Array.isArray(handles) ? handles : []).filter(handle => handle?.type === "source"
    && handleDataTypes(handle.dataType).some(type => mediaTypes.has(type)));
  const ordered = [
    ...sources.filter(handle => preferredHandleIds.includes(handle.id)),
    ...sources.filter(handle => !preferredHandleIds.includes(handle.id)),
  ];
  // ACT: 未挂载过的旧节点还没把 handles 同步进 data，退化到 outputs 的键顺序，避免误判成「不支持」。
  if (!sources.length) {
    const outputs = nodeData(node).outputs ?? {};
    const keys = [...preferredHandleIds.filter(id => id in outputs), ...Object.keys(outputs).filter(id => !preferredHandleIds.includes(id))];
    for (const key of keys) {
      const source = readMediaOutput(node, key);
      if (source) return source;
    }
    return undefined;
  }
  for (const handle of ordered) {
    const source = readMediaOutput(node, handle.id);
    if (source) return source;
  }
  return undefined;
}

/** 选中集合先展开分组：分组只是容器，入库必须落到它下面的叶子节点。 */
export function expandSelectionForAssets(selection: GraphNode[], nodes: GraphNode[]) {
  const children = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.parentNode) continue;
    const siblings = children.get(node.parentNode) ?? [];
    siblings.push(node);
    children.set(node.parentNode, siblings);
  }
  const result: GraphNode[] = [];
  const visited = new Set<string>();
  function visit(node: GraphNode) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (node.type === "canvasGroup") {
      for (const child of children.get(node.id) ?? []) visit(child);
      return;
    }
    result.push(node);
  }
  getSelectionRoots(selection, nodes).forEach(visit);
  return result;
}

export function assetNodeLabel(node: GraphNode) {
  const label = nodeData(node).label ?? node.label;
  return typeof label === "string" && label.trim() ? label.trim() : node.id;
}

export function assetFileExtension(url: string, mimeType: string) {
  const path = url.split(/[?#]/)[0] ?? "";
  const fromUrl = /\.([a-z0-9]{1,10})$/i.exec(path);
  if (fromUrl) return fromUrl[1]!.toLocaleLowerCase();
  const known = mimeExtensions[mimeType.toLocaleLowerCase()];
  if (known) return known;
  const subtype = mimeType.split("/")[1]?.split(";")[0]?.replace(/^x-/, "").replace(/\+.*$/, "");
  return subtype && /^[a-z0-9]{1,10}$/i.test(subtype) ? subtype.toLocaleLowerCase() : "";
}

/** 去掉文件名里的非法字符、首尾空格与结尾的点，截断到 200 字符；空名回退「素材」。 */
export function sanitizeAssetName(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim().replace(/\.+$/, "").trim();
  const clipped = [...cleaned].slice(0, maxNameLength).join("").trim().replace(/\.+$/, "").trim();
  return clipped || "素材";
}

function assetFileName(label: string, index: number, extension: string) {
  return sanitizeAssetName(`${label} ${index}${extension ? `.${extension}` : ""}`);
}

function importedName(path: string) {
  return path.split("/").pop() ?? path;
}

function wait(ms: number) {
  return new Promise<void>(resolve => { setTimeout(resolve, ms); });
}

/**
 * 把选中的图片/视频节点批量复制进项目素材库。
 * 只做复制，不移动也不删除工作区文件，所以源节点文件被清理后素材库里的副本仍然有效。
 */
export async function saveSelectionToAssets(flow: VueFlowStore, nodes: GraphNode[], directory: string): Promise<SaveSelectionToAssetsResult> {
  const items = expandSelectionForAssets(nodes, flow.getNodes.value);
  const result: SaveSelectionToAssetsResult = { saved: 0, failed: [], renamed: 0 };
  let cursor = 0;

  async function saveOne(node: GraphNode, index: number) {
    const label = assetNodeLabel(node);
    const source = getAssetSource(node);
    if (!source) {
      result.failed.push({ label, reason: "没有可导出的图片或视频" });
      return;
    }
    const name = assetFileName(label, index, assetFileExtension(source.value.url, source.value.mimeType));
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // ACT: 走 import 而不是 uploadAsset——源是工作区相对路径，服务端直接复制文件，
        // 不必把整段视频读进浏览器内存再通过 HTTP 传一遍。
        const imported = await importAsset({ library: "project", directory }, { kind: "workspace", path: source.value.url }, { name });
        // ACT: 重名以服务端自动改名为准（xxx (2).ext），前端只比对返回文件名来统计改名数，
        // 不自己拼序号，避免与服务端的并发写入抢同一个名字。
        if (importedName(imported.path) !== name) result.renamed++;
        result.saved++;
        return;
      } catch (error) {
        const info = toAssetError(error);
        // 服务端会先探测可用名再 COPYFILE_EXCL，只有另一请求恰好抢到同一名字时才会抛 409/EEXIST。
        if (attempt < maxAttempts - 1 && (info.status === 409 || info.code === "EEXIST")) {
          await wait(80 * (attempt + 1));
          continue;
        }
        result.failed.push({ label, reason: info.message || "导入失败" });
        return;
      }
    }
  }

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await saveOne(items[index]!, index + 1);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}
