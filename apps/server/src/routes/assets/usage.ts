import { Router } from "express";
import { z } from "zod";
import { getAssetUsages, getAssetUsagesBatch } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, pathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.get("/", validateAssetFields({ path: pathField, library: libraryField, directory: directoryField }, "query"), async (req, res) => {
  const library = await requestLibrary(req, { library: req.query.library as "global" | "project" | undefined, directory: req.query.directory as string | undefined });
  res.set("Cache-Control", "no-store").json(success(await getAssetUsages(library, req.query.path as string)));
});

// ACT: 批量删除/提示只扫描一次；所有路径共享 2000 文件 / 64 MB / 5 秒预算。
router.post("/batch", validateAssetFields({
  paths: z.array(pathField).min(1).max(200), library: libraryField, directory: directoryField,
}), async (req, res) => {
  const library = await requestLibrary(req, { library: req.body.library, directory: req.body.directory });
  res.set("Cache-Control", "no-store").json(success(await getAssetUsagesBatch(library, req.body.paths as string[])));
});
