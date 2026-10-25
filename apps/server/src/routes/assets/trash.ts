import { Router } from "express";
import { listTrash } from "@/utils/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, requestLibrary } from "@/utils/assets/routeSchema";

const router = Router();

export default router.get("/", validateAssetFields({ library: libraryField, directory: directoryField }, "query"), async (req, res) => {
  const library = await requestLibrary(req, { library: req.query.library as "global" | "project" | undefined, directory: req.query.directory as string | undefined });
  res.set("Cache-Control", "no-store").json(success(await listTrash(library)));
});
