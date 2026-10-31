import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { errorFromCause, success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  directory: z.string().min(1).max(4096),
  sessionFile: z.string().regex(/^[\w-]+\.jsonl$/),
}), async (req, res) => {
  const { directory, sessionFile } = req.body as { directory: string; sessionFile: string };
  const { directory: cwd, path } = await u.workspaceFile.resolveWorkspaceFile(req, directory, `.agent/sessions/${sessionFile}`);
  // ACT: 客户端断开后摘要调用仍在烧 token 且占着会话文件锁，断开即中止压缩。
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  req.once("aborted", abort);
  res.set("Cache-Control", "no-store").type("application/json");
  // ACT: 大历史压缩要 60-70 秒才出摘要，而 WKWebView 的请求空闲超时是 60 秒（WebKit 把 XHR 超时压到
  // 60 秒上限）。这期间一个字节都不发，连接就会被客户端掐断——前端只拿到一个没有响应体的错误，
  // 兜底提示「压缩上下文失败」，服务端也因 abort 什么都没写成。先发一个空白（JSON 允许前导空白），
  // 之后每 10 秒补一个，用持续的数据流动重置空闲计时。
  // 代价：首字节一发出状态码就固定了，失败只能靠响应体里的 code 表达（前端本来就是读 code 判成败）。
  const beat = () => {
    try {
      if (!res.writableEnded && !res.destroyed) res.write(" ");
    } catch {
      // 连接已断，交给 close 事件里的 abort 处理。
    }
  };
  beat();
  const timer = setInterval(beat, 10_000);
  let body: unknown;
  try {
    body = success(await u.agent.compactAgentSession(cwd, path, controller.signal));
  } catch (error) {
    body = errorFromCause(error);
  } finally {
    clearInterval(timer);
    res.off("close", abort);
    req.off("aborted", abort);
  }
  if (res.writableEnded || res.destroyed) return;
  res.end(JSON.stringify(body));
});
