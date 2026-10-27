import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { error } from "@/lib/responseFormat";
import { translateMessage, validationOptions } from "@/lib/i18n";
import { assertAssetRequest, hasAssetWorkspaceHeader, isSameOriginAssetRequest } from "./guard";
import { openAssetLibrary, type AssetLibraryKind } from "./roots";

export const libraryField = z.enum(["global", "project"]).optional();
export const directoryField = z.string().min(1).max(4096).optional();
export const pathField = z.string().min(1).max(4096);
export const optionalPathField = z.string().max(4096).optional();

/** 严格校验：未知字段直接报错，避免 library/directory 被静默丢弃。 */
export function validateAssetFields(shape: Record<string, z.ZodType>, source: "body" | "query" = "body") {
  const schema = z.strictObject(shape);
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source], validationOptions());
    if (!result.success) {
      const issues = result.error.issues.map(issue => ({ ...issue, message: translateMessage(issue.message) }));
      return res.status(400).json(error("参数错误", issues));
    }
    next();
  };
}

export function operationFailure(cause: unknown) {
  const failure = cause as { status?: number; code?: string; message?: string; usages?: unknown[]; checked?: string };
  const code = failure.code ?? "EINTERNAL";
  const status = failure.status ?? ({ ENOENT: 404, ENOTDIR: 404, EEXIST: 409, ENOTEMPTY: 409, EACCES: 403, EPERM: 403, EFBIG: 413 }[code] ?? 500);
  return {
    status,
    code,
    message: failure.message ?? "操作失败",
    ...(failure.usages ? { usages: failure.usages } : {}),
    ...(failure.checked ? { checked: failure.checked } : {}),
  };
}

export async function requestLibrary(req: Request, values: { library?: AssetLibraryKind; directory?: string }, media = false,
  options: { create?: boolean } = {}) {
  assertAssetRequest(req, { media });
  // ACT: 媒体端点已通过同源校验；桌面本地项目不在 workspaces 根下，需要沿用本机目录能力。
  const sameOriginMedia = media && !hasAssetWorkspaceHeader(req) && isSameOriginAssetRequest(req);
  return openAssetLibrary({ library: values.library, directory: values.directory }, req, {
    sameOriginMedia, ...(options.create === false ? { create: false } : {}),
  });
}
