import { createHash, randomUUID } from "node:crypto";
import { constants, copyFile, createReadStream, lstat, mkdir, stat } from "@toonflow/file";
import { dirname, extname } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

const router = Router();
// ACT: 一次粘贴引用的文件通常不到十张；上限只用于挡住异常负载。
const MAX_FILES = 200;

async function lstatOrNull(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  });
}

function hashFile(path: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// ACT: 同名不同内容时改名，绝不复用目标项目已有文件的内容。
function variantPath(path: string) {
  const extension = extname(path);
  const base = extension ? path.slice(0, -extension.length) : path;
  return `${base}-${randomUUID().slice(0, 8)}${extension}`;
}

function isBusy(cause: unknown) {
  const failure = cause as { code?: string; status?: number } | null;
  return failure?.code === "EBUSY" || failure?.status === 409;
}

function wait(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// ACT: 只锁目标。源文件可能正被节点写入，锁源会让整个粘贴因为别人在写而 409。
async function copyWithRetry(source: string, target: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let release: (() => void) | undefined;
    try {
      release = u.workspaceFile.lockWorkspaceFiles([target]);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target, constants.COPYFILE_EXCL);
      return;
    } catch (cause) {
      if (!isBusy(cause) || attempt === 2) throw cause;
      await wait(200 * 2 ** attempt);
    } finally {
      release?.();
    }
  }
}

/** ACT: `./library/x.png` 这类写法首段是 "."，必须先规范化再判断应用管理目录。 */
function topSegment(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(part => part && part !== ".")[0] ?? "";
}

export default router.post("/", validateFields({
  sourceDirectory: z.string().min(1).max(4096),
  targetDirectory: z.string().min(1).max(4096),
  paths: z.array(z.string().min(1).max(4096)).min(1).max(MAX_FILES),
}), async (req, res) => {
  const targetRoot = await u.workspace.resolveWorkspace(req, req.body.targetDirectory);
  const files: { source: string; target: string; action: "copied" | "reused" }[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  const failed: { path: string; message: string }[] = [];
  for (const path of new Set<string>(req.body.paths)) {
    let source: { directory: string; path: string };
    let size: number;
    try {
      source = await u.workspaceFile.resolveWorkspaceFile(req, req.body.sourceDirectory, path);
      const info = await stat(source.path);
      if (!info.isFile()) {
        skipped.push(path);
        continue;
      }
      size = info.size;
    } catch {
      missing.push(path);
      continue;
    }
    // ACT: 项目根的应用管理目录（library / library-assets / .toonflow）不参与跨项目搬运。
    if (u.workspaceFile.isHiddenWorkspaceEntry(topSegment(path))) {
      skipped.push(path);
      continue;
    }
    try {
      let targetRelative = path;
      let target = await u.workspaceFile.resolveWorkspacePath(targetRoot, targetRelative, true);
      const existing = await lstatOrNull(target.path);
      if (existing) {
        if (!existing.isFile()) {
          skipped.push(path);
          continue;
        }
        if (existing.size === size && await hashFile(source.path) === await hashFile(target.path)) {
          files.push({ source: path, target: targetRelative, action: "reused" });
          continue;
        }
        for (let attempt = 0; attempt < 5; attempt++) {
          targetRelative = variantPath(path);
          target = await u.workspaceFile.resolveWorkspacePath(targetRoot, targetRelative, true);
          if (!(await lstatOrNull(target.path))) break;
        }
      }
      u.workspaceFile.protectWorkspaceRoot(targetRoot, target.path);
      // ACT: 目标既然已在项目内，同样不能是这个项目的素材库/配置目录；越界与普通失败都只影响这一条。
      u.workspaceFile.protectWorkspaceLibraryPath(targetRoot, target.path);
      await copyWithRetry(source.path, target.path);
      files.push({ source: path, target: targetRelative, action: "copied" });
    } catch (cause) {
      failed.push({ path, message: cause instanceof Error ? cause.message : "复制失败" });
    }
  }
  res.json(success({ files, skipped, missing, failed }));
});
