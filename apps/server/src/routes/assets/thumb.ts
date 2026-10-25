import { Router } from "express";
import { z } from "zod";
import { sendFile } from "@/utils/fileHttp";
import { assertAssetExists, ensureAssetThumbnail } from "@/utils/assets";
import { error, success } from "@/lib/responseFormat";
import { directoryField, libraryField, pathField, requestLibrary, validateAssetFields } from "@/utils/assets/routeSchema";

const router = Router();

export default router.get("/", validateAssetFields({ path: pathField, library: libraryField, directory: directoryField,
  size: z.coerce.number().int().min(64).max(512).optional() }, "query"), async (req, res, next) => {
  // ACT: 缩略图可能由 <img> 直接请求，媒体端点放行同源请求；文件路径仍由 resolveWorkspacePath 校验。
  const library = await requestLibrary(req, { library: req.query.library as "global" | "project" | undefined,
    directory: req.query.directory as string | undefined }, true, { create: false });
  const entry = await assertAssetExists(library, req.query.path as string);
  if (!entry.info.isFile()) return res.status(404).json(error("缩略图不可用", null, 404));
  const size = req.query.size === undefined ? undefined : Number(req.query.size);
  const thumbnail = await ensureAssetThumbnail(library.root, entry.path, entry.absolute, entry.info.size, entry.info.mtimeMs, size);
  if (!thumbnail) return res.status(404).json(error("缩略图不可用", null, 404));
  const etag = `"${thumbnail.etag}"`;
  res.set({ "Cache-Control": "public, max-age=31536000, immutable", "ETag": etag, "X-Content-Type-Options": "nosniff" });
  if (req.get("if-none-match") === etag) return res.status(304).end();
  res.type("image/jpeg");
  await sendFile(res, thumbnail.path, {}, err => { if (err) next(err); });
});
