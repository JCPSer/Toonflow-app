import { lstat } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error } from "@/lib/responseFormat";
import { sendFile } from "@/modules/platformCore/fileHttp";
import { assertAssetRequest } from "@/modules/assetLibrary/assets/guard";
import { ensureAssetThumbnail } from "@/modules/assetLibrary/assets/thumb";
import { mentionAssetType } from "@/lib/mentionSources";
import { getStatus } from "@/modules/mediaGeneration/ffmpeg";

const router = Router();

/** ACT: 缩略图由 <img> 直接请求，无法携带工作区标记；按素材库媒体端点的方式只校验同源。 */
export default router.get("/", validateFields({ directory: z.string().min(1).max(4096), path: z.string().min(1).max(4096),
  size: z.coerce.number().int().min(64).max(1024).optional() }, "query"), async (req, res, next) => {
  assertAssetRequest(req, { media: true });
  const { directory, path } = await u.workspaceFile.resolveWorkspaceFile(req, req.query.directory as string, req.query.path as string, { sameOriginMedia: true });
  const info = await lstat(path);
  if (!info.isFile()) return res.status(404).json(error("缩略图不可用", null, 404));
  const { dataType } = mentionAssetType(path);
  if (dataType !== "IMAGE" && dataType !== "VIDEO") return res.status(400).json(error("该文件不支持缩略图", null, 400));
  const size = req.query.size === undefined ? 512 : Number(req.query.size);
  const thumbnail = await ensureAssetThumbnail(directory, path, path, info.size, info.mtimeMs, size);
  if (!thumbnail) {
    // ACT: FFmpeg 缺失用 424 区分于「这个文件生成不出来」，前端据此决定是否永久回退原视频。
    const status = await getStatus().catch(() => null);
    if (!status?.tools.ffmpeg.path) return res.status(424).json(error("缩略图需要 FFmpeg", null, 424));
    return res.status(404).json(error("缩略图不可用", null, 404));
  }
  const etag = `"${thumbnail.etag}"`;
  res.set({ "Cache-Control": "private, max-age=31536000, immutable", "ETag": etag, "X-Content-Type-Options": "nosniff" });
  if (req.get("if-none-match") === etag) return res.status(304).end();
  res.type("image/jpeg");
  await sendFile(res, thumbnail.path, {}, err => { if (err) next(err); });
});
