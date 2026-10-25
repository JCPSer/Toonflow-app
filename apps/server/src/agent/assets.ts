import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { lstat, readFile, realpath } from "@toonflow/file";
import { assetRequestSchema } from "@toonflow/tool-asset-operator/runtime";
import type { ToolContext } from "@toonflow/tools-scaffold/runtime";
import { resolve } from "node:path";
import { createAssetDirectory, importAssetFile, importFileIntoLibrary, moveAsset, openAssetLibrary, readAssetFile, removeAsset, writeAssetFile } from "@/utils/assets";
import type { AssetLibrarySelector } from "@/utils/assets/roots";
import { lockWorkspaceFiles, protectWorkspaceRoot, resolveWorkspacePath } from "@/utils/workspace/files";
import { queryMentionAssets } from "./mentionFiles";
import { mentionAssetType } from "./mentionSources";
import { getDocumentMimeType } from "@/lib/documentFormats";
import { readDocument } from "@/utils/documents";

async function readWorkspaceSource(cwd: string, path: string, signal?: AbortSignal) {
  const directory = await realpath(cwd);
  const source = await resolveWorkspacePath(directory, path);
  protectWorkspaceRoot(directory, source.path);
  const release = lockWorkspaceFiles([source.path]);
  try {
    signal?.throwIfAborted();
    const info = await lstat(source.path);
    if (!info.isFile()) throw new Error("来源必须是当前工作区内的普通文件");
    if (info.size > 100 * 1024 * 1024) throw new Error("素材文件不能超过 100 MB");
    const content = await readFile(source.path, { signal });
    if (content.byteLength > 100 * 1024 * 1024) throw new Error("素材文件不能超过 100 MB");
    return content;
  } finally { release(); }
}

export function createAssetContext(cwd: string): NonNullable<ToolContext["assets"]> {
  return {
    async execute(id, params, signal, onUpdate, executionContext) {
      const request = assetRequestSchema.parse(params);
      const { action, path, target } = request;
      // ACT: 工具未指定库时沿用旧行为（全局库）；项目库只允许当前工作区，避免模型借 directory 越权读取其他项目。
      const activeDirectory = await realpath(cwd);
      if (request.directory && await realpath(request.directory) !== activeDirectory) {
        throw Object.assign(new Error("只能操作当前工作区的项目素材库"), { status: 403 });
      }
      const selector: AssetLibrarySelector = { library: request.library ?? "global", directory: activeDirectory };
      const library = await openAssetLibrary(selector);
      signal?.throwIfAborted();
      let result;
      if (action === "list") {
        result = await queryMentionAssets({ path, query: request.query, cursor: request.cursor, limit: request.limit, signal,
          library: selector.library, directory: selector.directory });
      } else if (action === "read") {
        const file = await readAssetFile(path!, signal, selector);
        const { mimeType, dataType } = mentionAssetType(file.path);
        const isDocument = !!getDocumentMimeType(file.path, mimeType);
        const details = { path: file.path, revision: file.revision, mimeType, size: file.content.byteLength,
          ...(isDocument ? { contentType: "text/markdown" } : {}) };
        const isImage = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"].includes(mimeType);
        if (dataType !== "STRING" && !isImage && !isDocument) {
          return { content: [{ type: "text", text: `${JSON.stringify(details)}\n此格式不直接展示内容；使用 import 复制到工作区后预览或交给相应节点。` }], details };
        }
        const root = library.root;
        const absolutePath = resolve(root, file.path);
        const allowSnapshot = (candidate: string) => {
          signal?.throwIfAborted();
          if (resolve(candidate) !== absolutePath) throw new Error("只能读取本次已授权的素材快照");
        };
        const reader = createReadToolDefinition(root, { operations: {
          access: async candidate => { allowSnapshot(candidate); },
          readFile: async candidate => { allowSnapshot(candidate); return readDocument(file.path, file.content, mimeType); },
          detectImageMimeType: async candidate => { allowSnapshot(candidate); return isImage ? mimeType : null; },
        } });
        const read = await reader.execute(id, { path: absolutePath, offset: request.offset, limit: request.limit }, signal, onUpdate, executionContext);
        return { content: [{ type: "text", text: JSON.stringify(details) }, ...read.content], details: { ...read.details, ...details } };
      } else if (action === "create" || action === "update") {
        const content = request.content ?? await readWorkspaceSource(cwd, request.sourcePath!, signal);
        signal?.throwIfAborted();
        result = await writeAssetFile(path!, content, request.revision, selector);
      } else if (action === "collect") {
        // ACT: collect 是 import 的反方向：工作区文件直接复制进素材库，不经过模型或内存中转。
        const source = await resolveWorkspacePath(activeDirectory, request.sourcePath!);
        protectWorkspaceRoot(activeDirectory, source.path);
        result = await importFileIntoLibrary(library, source.path, { targetDir: request.targetDir, name: request.name });
      } else if (action === "import") {
        const imported = await importAssetFile(cwd, path!, target, signal, selector);
        const { mimeType, dataType } = mentionAssetType(imported.path);
        const details = { ...imported, mimeType };
        const url = imported.workspacePath.split("/").map(encodeURIComponent).join("/");
        const preview = dataType === "IMAGE" ? `\n![导入素材](<${url}>)` : "";
        return { content: [{ type: "text", text: `${JSON.stringify(details)}${preview}` }], details };
      } else {
        if (action === "mkdir") await createAssetDirectory(path!, selector);
        else if (action === "move") await moveAsset(path!, target!, selector);
        else await removeAsset(path!, selector, { force: request.force });
        result = { action, path, library: selector.library, ...(request.directory ? { directory: request.directory } : {}), ...(target ? { target } : {}) };
      }
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  };
}
