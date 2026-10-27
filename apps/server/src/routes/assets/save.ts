import { Router } from "express";
import { z } from "zod";
import { writeAssetEntry } from "@/modules/assetLibrary/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, pathField, requestLibrary } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.put("/", validateAssetFields({ path: pathField, library: libraryField, directory: directoryField,
  overwrite: z.enum(["true", "false"]).optional() }, "query"), async (req, res) => {
  if (!req.is("application/octet-stream") || (req.body !== undefined && !Buffer.isBuffer(req.body))) {
    throw Object.assign(new Error("请发送文件原始内容"), { status: 400 });
  }
  const library = await requestLibrary(req, { library: req.query.library as "global" | "project" | undefined, directory: req.query.directory as string | undefined });
  res.json(success(await writeAssetEntry(library, req.query.path as string, req.body ?? Buffer.alloc(0), {
    overwrite: req.query.overwrite === "true",
  })));
});
