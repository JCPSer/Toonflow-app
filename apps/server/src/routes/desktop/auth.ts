import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { readDesktopDialog, startDesktopDialog } from "@/modules/localRuntime/desktop/dialogSessions";

// ACT: 系统验证（Touch ID/登录密码）同样是「等用户操作」的两段式：POST 拉起弹窗并立刻返回会话 id，
// GET 轮询结果。直接 await 会撞上 WKWebView 60 秒无数据断流，用户稍微犹豫就丢掉验证结果。
const router = Router();

const startFields = {
  // ACT: 文案会显示在系统弹窗里，限制长度避免被当成提示语注入整段说明。
  reason: z.string().trim().min(1).max(120),
};

export default router
  .post("/", validateFields(startFields), async (req, res) => {
    const runtime = u.desktop.getDesktopRuntime(req);
    const { reason } = req.body as { reason: string };
    const id = startDesktopDialog(async () => {
      const result = await runtime.authenticate(reason);
      // ACT: 复用对话框会话表，value 用 "1"/"0" 承载结论，name 带上具体原因码。
      return { value: result.ok ? "1" : "0", name: result.code };
    });
    res.json(success({ id }));
  })
  .get("/", async (req, res) => {
    const runtime = u.desktop.getDesktopRuntime(req);
    // ACT: 不带 id 是能力探测：前端据此决定是否允许「隐藏项目」，
    // 否则在 Windows/旧安装包里能把项目藏进去却再也解不开。
    if (req.query.id === undefined) return res.json(success({ available: runtime.supportsAuthentication() }));
    const state = readDesktopDialog(req.query.id);
    if (!state) return res.status(404).json(error("验证已失效，请重试", null, 404));
    res.json(success(state));
  });
