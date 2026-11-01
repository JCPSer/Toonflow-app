import { Router } from "express";
import { z } from "zod";
import { agentLog } from "@/agentRuntime";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";

// ACT: 剪贴板写入在个别 WebView 里会出现「客户端报错、实际已写入」；先把客户端拿到的
// 状态码与错误原因落到 agent.log，和 clipboard.write.request/done 按 id 对上，再决定修法。
export default Router().post("/", validateFields({
  id: z.string().max(64).optional(),
  message: z.string().max(500).optional(),
  status: z.number().optional(),
  origin: z.string().max(300).optional(),
  href: z.string().max(1000).optional(),
  ua: z.string().max(500).optional(),
  length: z.number().optional(),
  hasClipboard: z.boolean().optional(),
}), (req, res) => {
  // ACT: 只记录 schema 里的字段；不要整包落日志，避免后续复用或误传把正文带进日志。
  const { id, message, status, origin, href, ua, length, hasClipboard } = req.body;
  agentLog("clipboard.write.clientError", { id, message, status, origin, href, ua, length, hasClipboard });
  res.json(success());
});
