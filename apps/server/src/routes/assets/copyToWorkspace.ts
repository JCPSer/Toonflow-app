import { basename, dirname, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { constants, copyFile, link, lstat, mkdir, unlink } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { assertAssetRelativePath, type AssetLibraryKind } from "@/modules/assetLibrary/assets/roots";
import { resolveWorkspace } from "@/modules/localRuntime/workspace";
import { lockWorkspaceFiles, resolveWorkspacePath } from "@/modules/localRuntime/workspace/files";
import { directoryField, libraryField, pathField, requestLibrary, validateAssetFields } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

// ACT: 跨卷（EXDEV）、权限/文件系统能力不足的报错语义一致，都回退为复制，避免拖入大文件失败。
const copyFallbackCodes = new Set(["EXDEV", "EPERM", "EACCES", "EMLINK", "ENOSYS", "EOPNOTSUPP"]);

/** 保留源文件扩展名（小写、最长 10 位）；非法字符直接丢弃，避免拼出奇怪的目标名。 */
function assetExtension(name: string) {
  const extension = extname(name).slice(1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(extension) ? `.${extension}` : "";
}

export default router.post("/", validateAssetFields({
  library: libraryField,
  directory: directoryField,
  path: pathField,
  workspaceDirectory: z.string().min(1).max(4096),
  nodeId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
}), async (req, res) => {
  const body = req.body as { library?: AssetLibraryKind; directory?: string; path: string; workspaceDirectory: string; nodeId: string };
  // ACT: 拖入只读库内已有文件，不能因为库根缺失就顺手创建 .library 标记。
  const library = await requestLibrary(req, { library: body.library, directory: body.directory }, false, { create: false });
  assertAssetRelativePath(body.path);
  const { path: source } = await resolveWorkspacePath(library.root, body.path);
  const info = await lstat(source);
  // ACT: 硬链接只对普通文件有意义；目录或符号链接会把工作区指向库外内容。
  if (info.isSymbolicLink() || !info.isFile()) throw Object.assign(new Error("只能把普通文件拖入工作区"), { status: 400 });

  let workspaceRoot: string;
  if (library.kind === "project") {
    if (!library.workspace) throw Object.assign(new Error("项目素材库必须提供工作区目录"), { status: 400 });
    // ACT: 项目库绑定自身工作区，请求里的目录必须一致，避免串项目写入。
    const same = process.platform === "win32"
      ? body.workspaceDirectory.toLowerCase() === library.workspace.toLowerCase()
      : body.workspaceDirectory === library.workspace;
    if (!same) throw Object.assign(new Error("项目素材库只能复制到所属工作区"), { status: 400 });
    workspaceRoot = library.workspace;
  } else {
    workspaceRoot = await resolveWorkspace(req, body.workspaceDirectory);
  }

  const targetRelative = `assets/${body.nodeId}/${randomUUID()}${assetExtension(basename(source))}`;
  // ACT: 目标目录可能还不存在，允许父级缺失后再递归创建。
  const { path: target } = await resolveWorkspacePath(workspaceRoot, targetRelative, true);
  await mkdir(dirname(target), { recursive: true });

  const release = lockWorkspaceFiles([target]);
  try {
    try {
      await link(source, target);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code ?? "";
      if (!copyFallbackCodes.has(code)) throw cause;
      await copyFile(source, target, constants.COPYFILE_EXCL);
    }
  } catch (cause) {
    // ACT: 复制/链接可能留下半成品，清理后原样抛出，错误 handler 依据 code 映射状态码。
    await unlink(target).catch(() => {});
    throw cause;
  } finally {
    release();
  }

  res.json(success({ path: targetRelative, name: basename(source), size: info.size }));
});
