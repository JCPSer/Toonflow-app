import { Router } from "express";
import { z } from "zod";
import { assertAssetRequest } from "@/utils/assets/guard";
import { patchAssetMetadata } from "@/utils/assets/library";
import { success } from "@/lib/responseFormat";
import { directoryField, libraryField, operationFailure, pathField, requestLibrary } from "@/utils/assets/routeSchema";

const router = Router();

const pathBatchField = z.union([pathField, z.array(pathField).min(1).max(200)]);
const bodySchema = z.strictObject({
  path: pathBatchField, tags: z.array(z.string().max(64)).max(20).optional(), note: z.string().max(2000).optional(),
  favorite: z.boolean().optional(), library: libraryField, directory: directoryField,
});

export default router.post("/", async (req, res) => {
  const body = bodySchema.parse(req.body);
  assertAssetRequest(req);
  const patch = {
    ...(body.tags !== undefined ? { tags: body.tags } : {}),
    ...(body.note !== undefined ? { note: body.note } : {}),
    ...(body.favorite !== undefined ? { favorite: body.favorite } : {}),
  };
  const library = await requestLibrary(req, { library: body.library, directory: body.directory });
  if (typeof body.path === "string") {
    res.json(success(await patchAssetMetadata(library, body.path, patch)));
    return;
  }
  const items: { ok: boolean; path: string; data?: unknown; error?: ReturnType<typeof operationFailure> }[] = [];
  for (const path of body.path) {
    try {
      items.push({ ok: true, path, data: await patchAssetMetadata(library, path, patch) });
    } catch (cause) {
      items.push({ ok: false, path, error: operationFailure(cause) });
    }
  }
  res.json(success({ items }));
});
