import { Router } from "express";
import { z } from "zod";
import { createAssetDirectory } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, pathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.post("/", validateAssetFields({ path: pathField, library: libraryField, directory: directoryField }), async (req, res) => {
  const library = await requestLibrary(req, { library: req.body.library, directory: req.body.directory });
  res.json(success(await createAssetDirectory(library, req.body.path)));
});
