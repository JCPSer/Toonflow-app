import type { GraphNode, VueFlowStore } from "@vue-flow/core";
import type { NodeData } from "@toonflow/nodes-scaffold/connection";
import { isNodeOutput, type NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import { getSelectionRoots } from "./selectionNodes";

/** 可入库的产物：内置节点的图片/视频输出都只有 url + mimeType。 */
export type AssetSource = { dataType: "IMAGE" | "VIDEO"; value: NodeMediaValue };

const mediaTypes = new Set(["IMAGE", "VIDEO"]);
const preferredHandleIds = ["image", "video"];
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
  // ACT: 先截断标题再拼接序号与扩展名；整串截断会把「 N.png」切掉，素材落盘后没有扩展名。
  const suffix = ` ${index}${extension ? `.${extension}` : ""}`;
  const stem = [...sanitizeAssetName(label)].slice(0, Math.max(1, maxNameLength - suffix.length)).join("").trim().replace(/\.+$/, "").trim();
  return sanitizeAssetName(`${stem || "素材"}${suffix}`);
}

/** 批量入库的一项：预览与写入共用同一份文件名，避免「弹窗显示 A、实际写入 B」。 */
export type PreparedAsset = {
  node: GraphNode;
  label: string;
  source?: AssetSource;
  /** 实际写入的文件名；无产物时退回 label，仅用于预览。 */
  name: string;
};

/**
 * 展开分组、剔除禁用节点，并按最终写入规则生成文件名。
 * ACT: 顺序即序号（「节点名 1.ext」），批量弹窗确认时看到的列表就是实际写入顺序。
 */
export function prepareSelectionAssets(flow: Pick<VueFlowStore, "getNodes">, nodes: GraphNode[]): PreparedAsset[] {
  return expandSelectionForAssets(nodes, flow.getNodes.value)
    .filter(node => nodeData(node).disabled !== true)
    .map((node, index) => {
      const label = assetNodeLabel(node);
      const source = getAssetSource(node);
      return {
        node,
        label,
        source,
        name: source ? assetFileName(label, index + 1, assetFileExtension(source.value.url, source.value.mimeType)) : label,
      };
    });
}
