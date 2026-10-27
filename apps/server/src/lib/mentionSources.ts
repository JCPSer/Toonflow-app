import { getDocumentMimeType, getTextMimeType } from "./documentFormats";

// ACT: 素材提及的查询参数与类型判定是素材库/工作区与 agent 之间的共享契约，下沉到 lib 以避免反向依赖。
export type MentionQuery = { query?: string; cursor?: string; limit?: number; signal?: AbortSignal };

export function mentionAssetType(path: string) {
  const documentMimeType = getDocumentMimeType(path);
  if (documentMimeType) return { mimeType: documentMimeType, dataType: "FILE" };
  const textMimeType = getTextMimeType(path);
  if (textMimeType) return { mimeType: textMimeType, dataType: "STRING" };
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", apng: "image/apng", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
    mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo", ogv: "video/ogg",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
  };
  const mimeType = types[extension] ?? "application/octet-stream";
  const dataType = !types[extension] ? "FILE" : mimeType.startsWith("image/") ? "IMAGE" : mimeType.startsWith("video/") ? "VIDEO" : mimeType.startsWith("audio/") ? "AUDIO" : "STRING";
  return { mimeType, dataType };
}
