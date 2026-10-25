import { Router } from "express";
import { z } from "zod";
import { assertAssetRequest } from "@/utils/assets/guard";
import { assertAssetExists, importFileIntoLibrary } from "@/utils/assets/library";
import { openAssetLibrary } from "@/utils/assets/roots";
import { resolveWorkspace } from "@/utils/workspace";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { success } from "@/lib/responseFormat";
import { directoryField, libraryField, pathField, requestLibrary, validateAssetFields } from "@/utils/assets/routeSchema";

const router = Router();

const sourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workspace"), path: pathField }),
  z.strictObject({ kind: z.literal("library"), library: z.enum(["global", "project"]), directory: directoryField, path: pathField }),
]);
const bodySchema = z.strictObject({
  library: libraryField, directory: directoryField, targetDir: z.string().max(4096).optional(), name: z.string().min(1).max(255).optional(), source: sourceSchema,
});

export default router.post("/", validateAssetFields({
  library: libraryField, directory: directoryField, targetDir: z.string().max(4096).optional(), name: z.string().min(1).max(255).optional(), source: sourceSchema,
}), async (req, res) => {
  const body = bodySchema.parse(req.body);
  assertAssetRequest(req);
  const target = await requestLibrary(req, { library: body.library, directory: body.directory });
  let sourcePath: string;
  if (body.source.kind === "workspace") {
    // ACT: 工作区来源必须绑定到已授权工作区；project 目标沿用目标工作区，global 目标则依赖顶层 directory。
    const workspace = target.workspace ?? (body.directory ? await resolveWorkspace(req, body.directory) : undefined);
    if (!workspace) throw Object.assign(new Error("工作区来源必须提供工作区目录 directory"), { status: 400 });
    sourcePath = (await resolveWorkspacePath(workspace, body.source.path)).path;
  } else {
    const sourceLibrary = await openAssetLibrary({ library: body.source.library, directory: body.source.directory }, req);
    sourcePath = (await assertAssetExists(sourceLibrary, body.source.path)).absolute;
  }
  res.json(success(await importFileIntoLibrary(target, sourcePath, { targetDir: body.targetDir, name: body.name })));
});
