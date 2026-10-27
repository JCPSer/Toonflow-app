import { Router } from "express";
import { assertAssetRequest } from "@/modules/assetLibrary/assets/guard";
import { getAssetsDirectory, getProjectLibraryLayout } from "@/modules/assetLibrary/assets/roots";
import { resolveWorkspace } from "@/modules/localRuntime/workspace";
import { success } from "@/lib/responseFormat";
import { directoryField, validateAssetFields } from "@/modules/assetLibrary/assets/routeSchema";

const router = Router();

export default router.get("/", validateAssetFields({ directory: directoryField }, "query"), async (req, res) => {
  assertAssetRequest(req);
  const global = await getAssetsDirectory();
  let project: { library: "project"; directory: string; root: string; path: string; fallback: boolean; exists: boolean } | null = null;
  if (req.query.directory) {
    const workspace = await resolveWorkspace(req, req.query.directory as string);
    // ACT: 此接口只探测实际库路径，不创建目录；前端据 path/fallback 提示用户。
    const layout = await getProjectLibraryLayout(workspace, { create: false });
    project = { library: "project", directory: workspace, root: layout.root, path: layout.relativePath, fallback: layout.fallback, exists: layout.exists };
  }
  res.set("Cache-Control", "no-store").json(success({ global: { library: "global", root: global, path: "", fallback: false, exists: true }, project }));
});
