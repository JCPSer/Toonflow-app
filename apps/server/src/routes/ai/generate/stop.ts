import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { validationOptions } from "@/lib/i18n";
import u from "@/utils";

const inputSchema = z.strictObject({ runId: z.uuid() });

export default Router().post("/", validateFields(inputSchema.shape), (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { runId } = inputSchema.parse(req.body, validationOptions());
  // ACT: 未命中同样返回成功：stop 早于 register 时由墓碑兜底，前端不该把正常竞态当错误。
  const { stopped } = u.aiRuns.stopRun(runId);
  console.log(`[ai.generate] stop ${stopped ? "hit" : "miss"} runId=${runId}`);
  res.json(success({ stopped }));
});
