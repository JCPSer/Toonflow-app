import type { Request } from "express";
import { mkdir, realpath } from "@toonflow/file";
import { dirname, resolve } from "node:path";
import u from "@/utils";

/**
 * 任务归属目录：导出用工程目录，导入用目标父目录（缺省为工作区根）。
 * 状态查询与取消必须走同一套推导，否则取不到自己刚建的任务。
 */
export async function resolveTaskScope(req: Request, directory?: string) {
  if (directory) return u.workspace.resolveWorkspace(req, directory);
  const root = resolve(dirname(u.conf.path), "workspaces");
  await mkdir(root, { recursive: true });
  return realpath(root);
}
