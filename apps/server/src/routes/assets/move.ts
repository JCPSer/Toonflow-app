import { Router } from "express";
import { z } from "zod";
import { assertAssetRequest } from "@/modules/assetLibrary/assets/guard";
import { moveAssetEntry } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { directoryField, libraryField, operationFailure, pathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

const sourceField = z.union([pathField, z.array(pathField).min(1).max(200)]);
const bodySchema = z.strictObject({ source: sourceField, target: z.string().max(4096), library: libraryField, directory: directoryField });

export default router.post("/", async (req, res) => {
  const body = bodySchema.parse(req.body);
  assertAssetRequest(req);
  if (typeof body.source === "string") {
    const library = await requestLibrary(req, { library: body.library, directory: body.directory });
    res.json(success(await moveAssetEntry(library, body.source, body.target)));
    return;
  }
  const library = await requestLibrary(req, { library: body.library, directory: body.directory });
  const items: { ok: boolean; path: string; target?: string; error?: ReturnType<typeof operationFailure> }[] = [];
  for (const source of body.source) {
    try {
      const result = await moveAssetEntry(library, source, body.target);
      items.push({ ok: true, path: source, target: result.path });
    } catch (cause) {
      items.push({ ok: false, path: source, error: operationFailure(cause) });
    }
  }
  res.json(success({ items }));
});
