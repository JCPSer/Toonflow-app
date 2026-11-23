import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { abortRunEverywhere } from "@/agent/bus";

/**
 * ACT: 总线模式下客户端只持有 runId，断开订阅时用它精确取消本次运行。
 * 与 /api/agent/abort（按会话文件、等待收尾）不同，这里直接 abort 本次 run 的 AbortController。
 */
export default Router().post("/", validateFields({
  runId: z.string().uuid(),
}), (req, res) => {
  const { runId } = req.body as { runId: string };
  const result = abortRunEverywhere(runId) ? "aborted" : "none";
  res.set("Cache-Control", "no-store").json(success({ result }));
});
