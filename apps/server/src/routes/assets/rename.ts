import { Router } from "express";
import { z } from "zod";
import { moveAssetEntryTo, renameAssetEntry } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, pathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.post("/", validateAssetFields({
  path: pathField, name: z.string().min(1).max(255).optional(), target: z.string().min(1).max(4096).optional(),
  library: libraryField, directory: directoryField,
}), async (req, res) => {
  if (!req.body.name && !req.body.target) throw Object.assign(new Error("请提供新名称 name 或完整目标路径 target"), { status: 400 });
  const library = await requestLibrary(req, { library: req.body.library, directory: req.body.directory });
  const result = req.body.name ? await renameAssetEntry(library, req.body.path, req.body.name)
    : await moveAssetEntryTo(library, req.body.path, req.body.target);
  res.json(success(result));
});
