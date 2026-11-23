import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { openBus, isBusId } from "@/agent/bus";
import u from "@/utils";

/**
 * ACT: 一个窗口只开一条 Agent 事件流。
 * 连接建立后不结束响应，运行事件由 /api/agent（带 x-agent-bus-id）发布到这里；
 * 连接断开时总线内所有运行统一 abort。
 */
export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
}), async (req, res) => {
  const busId = req.get("x-agent-bus-id") ?? "";
  if (!isBusId(busId)) return void res.status(400).json({ code: 400, message: "事件通道标识无效" });
  // ACT: 建立通道时校验一次工作区归属；每次启动运行仍会独立 resolveWorkspace。
  await u.workspace.resolveWorkspace(req, (req.body as { directory: string }).directory);
  openBus(busId, res);
});
