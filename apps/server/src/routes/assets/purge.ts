import { Router } from "express";
import { z } from "zod";
import { purgeTrash } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.post("/", validateAssetFields({
  id: z.string().min(1).max(128).regex(/^[\w-]+$/).optional(), all: z.boolean().optional(), library: libraryField, directory: directoryField,
}), async (req, res) => {
  if (!req.body.id && req.body.all !== true) throw Object.assign(new Error("请提供回收站项目 id 或 all:true"), { status: 400 });
  const library = await requestLibrary(req, { library: req.body.library, directory: req.body.directory });
  res.json(success(await purgeTrash(library, { id: req.body.id, all: req.body.all })));
});
