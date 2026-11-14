/**
 * 节点预览：从节点输出里挑出「最值得看一眼」的那一项。
 *
 * ACT: 只做纯选择，不碰 DOM。产物里的 url 是工作区相对路径（如 assets/<nodeId>/x.png），
 * 不是可直接请求的地址——解析成 blob URL 由预览组件用 useWorkspaceFiles 完成，
 * 这里只把路径与 mimeType 原样带出去，保持可单测。
 */

import { isNodeOutput, type NodeOutput } from "@toonflow/nodes-scaffold/values";
import type { NodeHandle } from "@toonflow/nodes-scaffold/connection";

export type NodePreviewKind = "image" | "video" | "audio";

export type NodePreviewTarget = {
  kind: NodePreviewKind;
  /** 工作区相对路径或绝对地址；由组件判断是否需要解析。 */
  url: string;
  mimeType: string;
  title: string;
};

export type PreviewableNode = {
  data?: {
    label?: unknown;
    handles?: NodeHandle[];
    outputs?: Record<string, NodeOutput | undefined>;
  } | null;
};

/** 与素材入库一致的优先端口：先看 image/video/audio，再按 handles 顺序。 */
const preferredHandleIds = ["video", "audio", "image", "mask"];
const mediaKinds: Record<string, NodePreviewKind | undefined> = {
  VIDEO: "video",
  AUDIO: "audio",
  IMAGE: "image",
  MASK: "image",
};

function nodeTitle(node: PreviewableNode | undefined) {
  const label = node?.data?.label;
  return typeof label === "string" && label.trim() ? label.trim() : "节点预览";
}

/** 输出键的考察顺序：优先端口在前，其余按声明顺序；没有 handles 时用 outputs 键序。 */
function orderedOutputKeys(node: PreviewableNode | undefined, outputs: Record<string, NodeOutput | undefined>) {
  const handles = node?.data?.handles;
  const declared = (Array.isArray(handles) ? handles : [])
    .filter(handle => handle?.type === "source" && typeof handle.id === "string")
    .map(handle => handle.id);
  const keys = declared.length ? [...new Set([...declared, ...Object.keys(outputs)])] : Object.keys(outputs);
  return [
    ...keys.filter(key => preferredHandleIds.includes(key)),
    ...keys.filter(key => !preferredHandleIds.includes(key)),
  ];
}

function mediaOf(output: NodeOutput | undefined) {
  if (!isNodeOutput(output)) return undefined;
  // 先按 dataType 收窄联合，再读 value——直接解构会丢掉判别式，TS 拿不到 url/mimeType。
  if (output.dataType !== "VIDEO" && output.dataType !== "AUDIO"
    && output.dataType !== "IMAGE" && output.dataType !== "MASK") return undefined;
  const kind = mediaKinds[output.dataType];
  const { url, mimeType } = output.value;
  if (!kind || !url || !mimeType) return undefined;
  return { kind, url, mimeType };
}

/**
 * 优先级：视频 > 音频 > 图片/掩码。
 * ACT: 视频节点的输出里常同时带首尾帧（IMAGE），预览必须给视频本体；
 * 同类多个时按「优先端口 → 声明顺序」取第一个，与素材入库的取法保持一致。
 */
export function pickNodePreview(node: PreviewableNode | undefined): NodePreviewTarget | undefined {
  const outputs = node?.data?.outputs;
  if (!outputs) return undefined;
  let image: ReturnType<typeof mediaOf>;
  let video: ReturnType<typeof mediaOf>;
  let audio: ReturnType<typeof mediaOf>;
  for (const key of orderedOutputKeys(node, outputs)) {
    const media = mediaOf(outputs[key]);
    if (!media) continue;
    if (media.kind === "video") video ??= media;
    else if (media.kind === "audio") audio ??= media;
    else image ??= media;
  }
  const picked = video ?? audio ?? image;
  return picked ? { ...picked, title: nodeTitle(node) } : undefined;
}
