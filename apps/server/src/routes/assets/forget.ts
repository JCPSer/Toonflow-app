import { lstat } from "@toonflow/file";
import { join } from "node:path";
import { Router } from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { flushLibraryIndex, removeLibraryEntries } from "@/utils/assets/libraryMeta";
import { directoryField, libraryField, requestLibrary, validateAssetFields } from "@/utils/assets/routeSchema";

const router = Router();

/** 只清理索引里的失效条目（文件已不在磁盘），不触碰磁盘内容。 */
export default router.post("/", validateAssetFields({
  library: libraryField,
  directory: directoryField,
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
}), async (req, res) => {
  const library = await requestLibrary(req, {
    library: req.body.library as "global" | "project" | undefined,
    directory: req.body.directory as string | undefined,
  });
  const paths = req.body.paths as string[];
  let removed = 0;
  for (const path of paths) {
    // ACT: 只清"磁盘上确实不存在"的条目；文件还在时删索引等于把它的标签/备注扔了。
    const exists = await lstat(join(library.root, path)).then(() => true).catch(() => false);
    if (exists) continue;
    await removeLibraryEntries(library.root, path);
    removed++;
  }
  await flushLibraryIndex(library.root);
  res.json(success({ removed }));
});
