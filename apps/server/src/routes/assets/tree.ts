import { Router } from "express";
import { treeAssetEntries } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, optionalPathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.get("/", validateAssetFields({ library: libraryField, directory: directoryField, path: optionalPathField }, "query"), async (req, res) => {
  const library = await requestLibrary(req, { library: req.query.library as "global" | "project" | undefined, directory: req.query.directory as string | undefined });
  res.set("Cache-Control", "no-store").json(success(await treeAssetEntries(library, req.query.path as string | undefined)));
});
