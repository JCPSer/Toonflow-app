import axios from "axios";
import { ElMessage } from "element-plus";
import type { useVueFlow } from "@vue-flow/core";
import { ensureNodeDirectory, uploadNodeFile } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import useWorkspaceFiles from "@/lib/workspaceFiles";

const assetDragType = "application/toonflow-asset";
/** 节点插件（历史记录弹窗）用指针拖拽把工作区文件放到画布时派发的事件名。 */
export const workspaceFileDropEvent = "toonflow:workspace-file-drop";
const fileMimeTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  avif: "image/avif", apng: "image/apng", bmp: "image/bmp", svg: "image/svg+xml", ico: "image/x-icon",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
  txt: "text/plain", md: "text/markdown", markdown: "text/markdown", csv: "text/csv", log: "text/plain",
  json: "application/json", xml: "application/xml", html: "text/html", css: "text/css", js: "text/javascript", ndjson: "application/x-ndjson",
};

const mediaExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "image/apng": "apng", "image/bmp": "bmp", "image/svg+xml": "svg", "image/x-icon": "ico",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-matroska": "mkv", "video/x-msvideo": "avi",
};

function inferredMediaType(file: File) {
  const type = file.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (/^(image|audio|video)\//.test(type)) return type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return fileMimeTypes[extension] ?? "";
}

function clipboardMediaName(type: string, index: number) {
  const extension = mediaExtensions[type] ?? (type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin");
  return "pasted-media-" + Date.now() + "-" + (index + 1) + "." + extension;
}

export function createClipboardMediaFile(blob: Blob, index = 0) {
  const file = blob instanceof File ? blob : undefined;
  const type = (file && inferredMediaType(file)) || (/^(image|audio|video)\//.test(blob.type) ? blob.type : "application/octet-stream");
  return new File([blob], clipboardMediaName(type, index), { type });
}

export function getClipboardMediaFiles(event: ClipboardEvent) {
  const transfer = event.clipboardData;
  if (!transfer) return [];
  const files: File[] = [];
  for (const item of transfer.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && inferredMediaType(file)) files.push(file);
  }
  if (!files.length) files.push(...Array.from(transfer.files).filter(file => !!inferredMediaType(file)));
  return files.map((file, index) => createClipboardMediaFile(file, index));
}

export function startAssetDrag(event: DragEvent, entry: { type: string; path: string }) {
  if (entry.type !== "file" || !event.dataTransfer) return;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(assetDragType, entry.path);
}

export function isCanvasFileDrag(event: DragEvent) {
  return event.dataTransfer?.types.some(type => type === assetDragType || type === "Files") ?? false;
}

type AssetSource = { path: string; library?: "global" | "project"; directory?: string };

function isTextAssetMime(mime: string) {
  return mime.startsWith("text/") || /^application\/(json|xml|javascript|x-ndjson)$/.test(mime);
}

/** 服务端直接硬链接（跨盘回退复制）到工作区，返回工作区相对路径；大文件不再经过浏览器中转。 */
async function copyAssetToWorkspace(assetSource: AssetSource, nodeId: string, workspaceDirectory: string, signal?: AbortSignal) {
  const { data } = await axios.post<{ code: number; data: { path: string } | null; message?: string }>(
    "/api/assets/copyToWorkspace",
    {
      ...(assetSource.library ? { library: assetSource.library } : {}),
      ...(assetSource.directory ? { directory: assetSource.directory } : {}),
      path: assetSource.path,
      workspaceDirectory,
      nodeId,
    },
    { headers: { "x-toonflow-workspace": "1" }, signal },
  );
  if (data.code !== 200 || !data.data) throw new Error(data.message || "素材复制失败");
  return data.data.path;
}

type CanvasFileContext = {
  directory: string;
  availableNodes: { type: string }[];
  signal: AbortSignal;
  flow: Pick<ReturnType<typeof useVueFlow>, "addNodes" | "screenToFlowCoordinate">;
};

export async function dropCanvasFiles(event: DragEvent, context: CanvasFileContext) {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  const rawAsset = transfer.getData(assetDragType);
  // 新素材库面板携带库与项目目录，旧组件仍传纯相对路径。
  let assetSource: { path: string; library?: "global" | "project"; directory?: string } | undefined;
  if (rawAsset) {
    try {
      const parsed = JSON.parse(rawAsset) as { path?: unknown; library?: unknown; directory?: unknown };
      if (typeof parsed.path === "string") assetSource = { path: parsed.path, library: parsed.library === "project" ? "project" : "global", directory: typeof parsed.directory === "string" ? parsed.directory : undefined };
    } catch {
      assetSource = { path: rawAsset };
    }
  }
  let droppedFiles = Array.from(transfer.files);
  let prepared: { id: string; path: string; ownedDirectory?: string }[] | undefined;
  const { signal, flow } = context;
  const position = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY });
  try {
    signal.throwIfAborted();
    if (assetSource) {
      const name = assetSource.path.split("/").pop()!;
      const extension = name.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = fileMimeTypes[extension] ?? "";
      // ACT: 媒体类只传库内相对路径，由服务端硬链接/复制；文本类体积小且需要正文，仍走 read + text()。
      if (mimeType && !isTextAssetMime(mimeType)) {
        const id = crypto.randomUUID();
        let path: string;
        try {
          path = await copyAssetToWorkspace(assetSource, id, context.directory, signal);
        } catch (error) {
          // ACT: 请求被取消时服务端可能已经落盘、只是响应没回来；按 nodeId 目录兜底清理，避免孤儿文件。
          await useWorkspaceFiles(context.directory).remove(`assets/${id}`, true).catch(() => {});
          throw error;
        }
        if (signal.aborted) {
          await useWorkspaceFiles(context.directory).remove(`assets/${id}`, true).catch(() => {});
          signal.throwIfAborted();
        }
        droppedFiles = [new File([], name, { type: mimeType })];
        prepared = [{ id, path }];
      } else {
        const { data } = await axios.get<Blob>("/api/assets/read", {
          params: { path: assetSource.path, library: assetSource.library, directory: assetSource.directory },
          headers: { "x-toonflow-workspace": "1" },
          responseType: "blob",
          signal,
        });
        droppedFiles = [new File([data], name, { type: data.type || mimeType })];
      }
    }
    await importCanvasFiles(droppedFiles, position, context, prepared);
  } catch (error) {
    if (!signal.aborted) showError(error);
  }
}

export type WorkspaceFileDrop = { path: string; mimeType?: string; clientX: number; clientY: number };

/** 工作区内已有文件（节点历史记录）落到画布：服务端复制到新节点目录，再走统一的建节点流程。 */
export async function dropWorkspaceFile(source: Omit<WorkspaceFileDrop, "clientX" | "clientY">, position: { x: number; y: number }, context: CanvasFileContext) {
  const { signal } = context;
  const name = source.path.split("/").pop() ?? "";
  const mimeType = source.mimeType || fileMimeTypes[name.split(".").pop()?.toLowerCase() ?? ""] || "";
  const kind = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : undefined;
  if (!name || !kind) throw new Error(`${name || "该文件"}：暂不支持拖到画布`);
  // ACT: 先确认节点类型已启用再落盘，避免复制完才发现导不进来，留下孤儿文件。
  if (!context.availableNodes.some(node => node.type === `remote-${kind}Node`)) throw new Error(`${name}：请先安装并启用对应的基础节点`);
  const id = crypto.randomUUID();
  const files = useWorkspaceFiles(context.directory);
  const directory = await ensureNodeDirectory(files, id);
  const target = `${directory}/${name}`;
  try {
    // ACT: 建目录是异步的，期间画布可能已被切走；此时不必再复制十几 MB 再回滚。
    signal.throwIfAborted();
    await files.copy(source.path, target);
  } catch (error) {
    await files.remove(directory, true).catch(() => {});
    throw error;
  }
  if (signal.aborted) {
    await files.remove(directory, true).catch(() => {});
    signal.throwIfAborted();
  }
  // ACT: 目录是为这个新节点建的；后续建节点失败时要连目录一起回收。
  await importCanvasFiles([new File([], name, { type: mimeType })], position, context, [{ id, path: target, ownedDirectory: directory }]);
}

export async function importCanvasFiles(droppedFiles: File[], position: { x: number; y: number }, context: CanvasFileContext,
  prepared?: { id: string; path: string; ownedDirectory?: string }[]) {
  const { signal, flow, availableNodes } = context;
  const files = useWorkspaceFiles(context.directory);
  /** 回滚：先删文件再删（本次新建的）节点目录，目录里的其它文件不归这里管。 */
  async function rollback(preparedPath: string | undefined, ownedDirectory: string | undefined) {
    if (preparedPath) await files.remove(preparedPath).catch(error => console.warn("回滚落盘文件失败", preparedPath, error));
    if (ownedDirectory) await files.remove(ownedDirectory, true).catch(error => console.warn("回滚节点素材目录失败", ownedDirectory, error));
  }
  for (const [index, file] of droppedFiles.entries()) {
    // ACT: 取消发生在建节点之前时，服务端已落盘的素材也要回滚，避免留下无人引用的文件。
    if (signal.aborted) {
      for (const item of prepared?.slice(index) ?? []) await rollback(item.path, item.ownedDirectory);
      break;
    }
    // ACT: 素材库拖入时服务端已按目标 nodeId 落盘，节点 id 必须与目录名一致。
    const id = prepared?.[index]?.id ?? crypto.randomUUID();
    // ACT: 素材库拖入的文件在进入循环前就已落盘，任何后续失败（如节点未启用）都要能回滚。
    let copiedPath: string | undefined = prepared?.[index]?.path;
    try {
      const fileType = file.type.split(";")[0]!.trim().toLowerCase();
      const extension = file.name.split(".").pop()!.toLowerCase();
      const mimeType = !fileType || fileType === "application/octet-stream" ? fileMimeTypes[extension] ?? fileType : fileType;
      const kind = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video"
        : mimeType.startsWith("text/") || /^application\/(json|xml|javascript|x-ndjson)$/.test(mimeType) ? "text" : undefined;
      if (!kind) throw new Error(`${file.name}：该文件类型暂不支持导入画布`);
      const type = `remote-${kind}Node`;
      if (!availableNodes.some(node => node.type === type)) throw new Error(`${file.name}：请先安装并启用对应的基础节点`);
      let output: NodeOutput | undefined;
      let textSnapshot: string | undefined;
      if (kind === "text") {
        textSnapshot = await file.text();
      } else {
        copiedPath = prepared?.[index]?.path ?? await uploadNodeFile(files, id, file);
        // ACT: 落盘即预热首帧缩略图，画布打开时不用等 FFmpeg。
        if (kind === "video") files.warmThumb(copiedPath);
        output = { dataType: kind === "image" ? "IMAGE" : kind === "audio" ? "AUDIO" : "VIDEO", value: { url: copiedPath, mimeType } };
      }
      signal.throwIfAborted();
      flow.addNodes({ id, type, position: { x: position.x + index * 32, y: position.y + index * 32 },
        data: kind === "text" ? { label: file.name, textSnapshot } : { label: file.name, outputs: { [kind]: output } } });
    } catch (error) {
      await rollback(copiedPath, prepared?.[index]?.ownedDirectory);
      if (!signal.aborted) showError(error);
    }
  }
}

function showError(error: unknown) {
  ElMessage.error(axios.isAxiosError<{ message: string }>(error) ? error.response?.data.message || error.message : error instanceof Error ? error.message : "文件导入失败");
}
