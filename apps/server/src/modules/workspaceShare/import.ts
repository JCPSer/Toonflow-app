import { lstat, mkdir, readFile, realpath, rename, rm } from "@toonflow/file";
import { dirname, join } from "node:path";
import u from "@/utils";
import { extractShareEntry, readShareHeader, readShareManifest } from "./container";
import { isCanvasContent } from "./discover";

const MAX_CANVAS_BYTES = 20 * 1024 * 1024;
import { SHARE_MAX_ENTRIES, type ShareManifest } from "./types";

export interface ImportProjectOptions {
  filePath: string;
  parent: string;
  password?: string;
  signal: AbortSignal;
  onProgress(patch: { phase?: "importing"; done?: number; total?: number; currentFile?: string }): void;
}

export interface ImportResult {
  directory: string;
  name: string;
  manifest: ShareManifest;
}

/** 目标目录名优先用 manifest 里的工程名；重名才加后缀，避免列表里全是随机串。 */
async function uniqueDirectory(parent: string, rawName: string) {
  const base = sanitizeName(rawName) || "Toonflow";
  for (let index = 1; index < 1000; index++) {
    const name = index === 1 ? base : `${base}-${index}`;
    const candidate = join(parent, name);
    if (!await lstat(candidate).catch(() => null)) return { name, directory: candidate };
  }
  throw Object.assign(new Error("无法为导入的工程分配目录名"), { status: 409 });
}

function sanitizeName(name: unknown) {
  return String(name ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0, 80);
}

export async function importProject(options: ImportProjectOptions): Promise<ImportResult> {
  const { signal, onProgress } = options;
  signal.throwIfAborted();

  const header = await readShareHeader(options.filePath);
  const manifest = await readShareManifest(options.filePath, options.password);
  if (manifest.entries.length > SHARE_MAX_ENTRIES) throw Object.assign(new Error("分享包条目过多，已拒绝导入"), { status: 400 });

  const { name, directory } = await uniqueDirectory(options.parent, manifest.project?.name ?? "");
  // ACT: 先写到 `.partial` 再整体 rename 发布——中途失败时工程列表里不会出现半成品工程。
  const partial = `${directory}.partial-${crypto.randomUUID().slice(0, 8)}`;
  let created: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    await mkdir(partial);
    created = await lstat(partial);
    const total = manifest.entries.length;
    for (const [index, entry] of manifest.entries.entries()) {
      signal.throwIfAborted();
      onProgress({ phase: "importing", done: index + 1, total, currentFile: entry.path });
      // ACT: 先用宽松解析算出落点并建父目录，再用严格解析写盘——严格解析会 lstat 整条父链，
      // 父目录还没建出来时会直接 ENOENT。
      const candidate = await u.workspaceFile.resolveWorkspacePath(partial, entry.path, true);
      await mkdir(dirname(candidate.path), { recursive: true });
      const target = await u.workspaceFile.resolveWorkspacePath(partial, entry.path);
      await extractShareEntry(options.filePath, header, entry, target.path, options.password, signal);
    }

    // ACT: 工程根标记决定「素材库根」与「同源缩略图」是否成立；旧包或裁剪过的包可能没带，
    // 缺了会让导入后的工程看起来像坏掉（库文件消失、封面破图），这里补最小可用版本。
    await ensureProjectMarkers(partial, manifest);

    // ACT: 只探测像画布大小的 JSON；素材目录里的 manifest.json 动辄上百 MB，整体读进来会打爆内存。
    const canvasPaths = manifest.entries
      .filter(entry => /\.json$/i.test(entry.path) && entry.size <= MAX_CANVAS_BYTES && !/^(?:assets|library|library-assets)\//i.test(entry.path))
      .map(entry => entry.path);
    let hasCanvas = false;
    for (const path of canvasPaths) {
      const content = await readFile(join(partial, path)).catch(() => null);
      if (content && isCanvasContent(content)) { hasCanvas = true; break; }
    }
    if (!hasCanvas) throw Object.assign(new Error("分享包里没有有效的画布文件"), { status: 400 });
    await rename(partial, directory);
    return { directory, name, manifest };
  } catch (error) {
    if (created) {
      try {
        const current = await lstat(partial);
        const actual = await realpath(partial);
        if (current.isSymbolicLink() || current.ino !== created.ino || current.dev !== created.dev || actual !== partial) {
          throw new Error("目录已变更，未自动删除");
        }
        await rm(partial, { recursive: true });
      } catch (cleanupError) {
        throw new Error(`导入失败，且未能清理目录 ${partial}：${cleanupError instanceof Error ? cleanupError.message : "请检查目录权限"}`, { cause: error });
      }
    }
    throw error;
  }
}

async function ensureProjectMarkers(directory: string, manifest: ShareManifest) {
  // .toonflow/ui.json：同源媒体与缩略图只放行「已知项目根」，这个文件是判定依据之一。
  const uiFile = join(directory, ".toonflow", "ui.json");
  if (!await lstat(uiFile).catch(() => null)) {
    await mkdir(dirname(uiFile), { recursive: true });
    const content = { version: 1, lastCanvas: manifest.canvases[0] ?? manifest.entries.find(entry => /\.json$/i.test(entry.path))?.path ?? "", updatedAt: new Date().toISOString() };
    await u.workspaceFile.writeWorkspaceFile(uiFile, new TextEncoder().encode(JSON.stringify(content)), true);
  }
  // library/.library/index.json：缺了会让素材库根判定失败并静默降级到空 library-assets。
  const libraryIndex = join(directory, "library", ".library", "index.json");
  if (!await lstat(libraryIndex).catch(() => null)) {
    await mkdir(dirname(libraryIndex), { recursive: true });
    await u.workspaceFile.writeWorkspaceFile(libraryIndex, new TextEncoder().encode(JSON.stringify({ version: 1, entries: {}, trash: {} })), true);
  }
}
