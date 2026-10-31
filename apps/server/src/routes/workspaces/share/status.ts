import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { status } from "@/modules/workspaceShare/tasks";
import { resolveTaskScope } from "./scope";

export default Router().get("/", validateFields({
  id: z.string().min(1).max(100),
  directory: z.string().max(4096).optional(),
}, "query"), async (req, res) => {
  const scope = await resolveTaskScope(req, req.query.directory as string | undefined);
  const state = status(scope, req.query.id as string);
  if (!state) return res.status(404).json(error("分享任务不存在或已过期", null, 404));
  // ACT: 每 800ms 轮询一次，manifest 的 entries 可能上千条，没必要反复传；前端只用 stats 与文件数。
  const { entries: _entries, ...manifest } = state.result?.manifest ?? { entries: [] };
  res.set("Cache-Control", "no-store").json(success(state.result ? { ...state, result: { ...state.result, manifest } } : state));
});
