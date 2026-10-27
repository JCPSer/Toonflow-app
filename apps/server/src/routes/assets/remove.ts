import { Router, type Response } from "express";
import { z } from "zod";
import { assertAssetRequest } from "@/modules/assetLibrary/assets/guard";
import { removeAssetEntries, removeAssetEntry } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { directoryField, libraryField, operationFailure, pathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

const pathBatchField = z.union([pathField, z.array(pathField).min(1).max(200)]);
const bodySchema = z.strictObject({
  path: pathBatchField, permanent: z.boolean().optional(), force: z.boolean().optional(), library: libraryField, directory: directoryField,
});

function referencedResponse(res: Response, cause: unknown) {
  const failure = cause as { status?: number; code?: string; usages?: unknown[]; checked?: string; message?: string };
  // ACT: 引用列表需要随错误一起返回，通用错误处理只保留 code，因而在这里显式响应。
  res.status(409).json({ code: 409, data: { code: "EREFERENCED", usages: failure.usages ?? [], checked: failure.checked ?? "complete" },
    message: failure.message ?? "素材正被引用" });
}

export default router.delete("/", async (req, res) => {
  const body = bodySchema.parse(req.body);
  assertAssetRequest(req);
  if (typeof body.path === "string") {
    const library = await requestLibrary(req, { library: body.library, directory: body.directory });
    try {
      res.json(success(await removeAssetEntry(library, body.path, { permanent: body.permanent, force: body.force })));
    } catch (cause) {
      if ((cause as { code?: string }).code !== "EREFERENCED") throw cause;
      referencedResponse(res, cause);
    }
    return;
  }
  const library = await requestLibrary(req, { library: body.library, directory: body.directory });
  // ACT: 批量删除共享一次引用扫描（force 时跳过扫描），不再为每一项重复全量扫描。
  const outcomes = await removeAssetEntries(library, body.path, { permanent: body.permanent, force: body.force });
  const items = outcomes.map(outcome => {
    if (outcome.cause !== undefined) return { ok: false, path: outcome.path, error: operationFailure(outcome.cause) };
    const { path: _path, ...details } = outcome.result!;
    return { ok: true, path: outcome.path, ...details };
  });
  res.json(success({ items }));
});
