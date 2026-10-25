import { readdir } from "@toonflow/file";
import { join, relative, sep } from "node:path";
import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { assertAssetRequest } from "@/utils/assets/guard";
import { listAssetEntries } from "@/utils/assets/library";
import { success } from "@/lib/responseFormat";
import { validateAssetFields, directoryField, libraryField, optionalPathField, requestLibrary } from "@/utils/assets/routeSchema";

type AssetEntry = { name: string; path: string; type: "file" | "directory" };

const router = Router();

/** @deprecated 旧前端无参全树分支，仅保留根目录一层；新前端使用 /tree 与分页 /list。 */
async function listDeprecatedRoot(root: string, directory: string): Promise<AssetEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter(entry => (entry.isFile() || entry.isDirectory()) && !entry.name.startsWith(".")
    && ![".library", ".trash", ".thumbs"].includes(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
    .map(entry => ({
      name: entry.name,
      path: relative(root, join(directory, entry.name)).split(sep).join("/"),
      type: entry.isDirectory() ? "directory" : "file",
    }));
}

const shape = {
  library: libraryField,
  directory: directoryField,
  path: optionalPathField,
  cursor: z.string().max(4096).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  sort: z.enum(["name", "mtime", "size", "type"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  query: z.string().max(500).optional(),
  type: z.string().max(32).optional(),
  favorite: z.enum(["true", "false"]).optional(),
};

export default router.get("/", validateAssetFields(shape, "query"), async (req, res) => {
  const hasModernParams = Object.keys(shape).some(key => req.query[key] !== undefined);
  // ACT: 旧调用不带任何参数时只保留根目录一层兼容，并显式标记弃用，避免继续维持全树扫描。
  if (!hasModernParams) {
    assertAssetRequest(req);
    const directory = await u.assets.getAssetsDirectory();
    res.set({ "Cache-Control": "no-store", "Deprecation": "true" })
      .json(success({ entries: await listDeprecatedRoot(directory, directory), deprecated: true }));
    return;
  }
  const library = await requestLibrary(req, { library: req.query.library as "global" | "project" | undefined, directory: req.query.directory as string | undefined });
  const result = await listAssetEntries(library, {
    path: req.query.path as string | undefined,
    cursor: req.query.cursor as string | undefined,
    limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
    sort: req.query.sort as "name" | "mtime" | "size" | "type" | undefined,
    order: req.query.order as "asc" | "desc" | undefined,
    query: req.query.query as string | undefined,
    type: req.query.type as string | undefined,
    favorite: req.query.favorite === "true" ? true : req.query.favorite === "false" ? false : undefined,
  });
  res.set("Cache-Control", "no-store").json(success(result));
});
