import type { AgentMention } from "@toonflow/server/agent/types";

/** 旧会话没有 library 字段，按全局素材展示。 */
export function mentionLibraryLabel(mention: AgentMention) {
  return mention.source.kind === "asset" && mention.source.library === "project" ? "本项目素材" : "全局素材";
}

export function mentionName(mention: AgentMention) {
  return `${mention.source.kind === "asset" ? mentionLibraryLabel(mention) : mention.source.canvasName} / ${mention.label}`;
}

export function mentionThumbnailProps(mention: AgentMention) {
  const value = mention.value as { url?: unknown; mimeType?: unknown } | null;
  return {
    thumbnail: ["IMAGE", "MASK", "VIDEO"].includes(mention.dataType) && typeof value?.url === "string" && typeof value.mimeType === "string"
      ? { url: value.url, mimeType: value.mimeType } : undefined,
    // 未快照素材的 value.url 仍等于库内相对路径；快照后变为 assets/chat/... 的工作区路径。
    globalAsset: mention.source.kind === "asset" && value?.url === mention.source.path,
    library: mention.source.kind === "asset" ? mention.source.library ?? "global" : undefined,
  };
}

export function mentionParts(content: string, mentions: AgentMention[] = []) {
  const byId = new Map(mentions.map(mention => [mention.id, mention]));
  return content.split(/(\{\{mention:[^{}]+\}\})/g).filter(Boolean).map(text => {
    const id = /^\{\{mention:([^{}]+)\}\}$/.exec(text)?.[1];
    return { text, mention: id ? byId.get(id) : undefined };
  });
}

export function mentionPlainText(content: string, mentions?: AgentMention[]) {
  return mentionParts(content, mentions).map(part => part.mention ? `@${mentionName(part.mention)}` : part.text).join("");
}
