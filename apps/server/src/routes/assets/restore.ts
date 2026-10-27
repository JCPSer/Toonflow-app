import { Router } from "express";
import { z } from "zod";
import { restoreAssetEntry } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.post("/", validateAssetFields({ id: z.string().min(1).max(128).regex(/^[\w-]+$/), library: libraryField, directory: directoryField }), async (req, res) => {
  const library = await requestLibrary(req, { library: req.body.library, directory: req.body.directory });
  res.json(success(await restoreAssetEntry(library, req.body.id)));
});
