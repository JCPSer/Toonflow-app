import { Router } from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { friendlyMonitorError, invalidateStatus, parseMonitorBase } from "@/utils/monitor";

const router = Router();

// ACT: ComfyUI 的 POST /free 只设置队列 flag，由执行线程在空闲或当前任务结束后消费；
// 因此这里不会打断正在生成的任务，清理动作可能延后到该任务结束。
export default router.post("/", async (req, res) => {
  if (!u.workspace.isLocalWorkspaceRequest(req)) return res.status(403).json(error("只能在本机操作监控状态", null, 403));
  const base = parseMonitorBase((req.body as { url?: unknown } | undefined)?.url);
  if (!base) return res.status(400).json(error("请填写不含账号密码和查询参数的 HTTP(S) 地址"));

  try {
    const response = await fetch(`${base}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.body?.cancel().catch(() => {});
    // ACT: 清理后立即失效状态缓存，下一次刷新看到的是新的显存占用。
    invalidateStatus(base);
    res.json(success({ freed: true }, "已请求清理显存"));
  } catch (err) {
    res.status(502).json(error(`清理显存失败：${friendlyMonitorError(err)}`, null, 502));
  }
});
