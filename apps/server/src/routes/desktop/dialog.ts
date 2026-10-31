import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";
import { readDesktopDialog, startDesktopDialog } from "@/modules/localRuntime/desktop/dialogSessions";

// ACT: 两段式对话框。POST 只负责拉起面板并立刻返回会话 id；GET 读取结果。
// 响应不能绑在对话框生命周期上——WKWebView 对无数据请求有 60 秒上限，用户挑满一分钟必丢结果。
const router = Router();

const startFields = {
  kind: z.enum(["directory", "openFile", "saveFile", "providerFile"]),

  // 保存对话框需要文件名；校验规则与原先的 selectSaveFile 一致。
  fileName: z.string().min(1).max(240).regex(/^[^\\/:*?"<>|\u0000-\u001f]+$/).refine(name => name !== "." && name !== ".." && !/[. ]$/.test(name)).optional(),
  // 打开文件时的扩展名过滤（单个，不含点）。
  extension: z.string().min(1).max(32).regex(/^[A-Za-z0-9]+$/).optional(),
};

export default router
  .post("/", validateFields(startFields), async (req, res) => {
    const runtime = u.desktop.getDesktopRuntime(req);
    const { kind, fileName, extension } = req.body as { kind: "directory" | "openFile" | "saveFile" | "providerFile"; fileName?: string; extension?: string };
    let run: () => Promise<{ value: string | null; name?: string }>;
    switch (kind) {
      case "directory":
        run = async () => ({ value: await runtime.selectDirectory() });
        break;
      case "openFile":
        run = async () => ({ value: await runtime.selectOpenFile(extension ?? "tfproj") });
        break;
      case "saveFile":
        if (!fileName) throw Object.assign(new Error("缺少保存文件名"), { status: 400 });
        run = async () => ({ value: await runtime.selectSaveFile(fileName) });
        break;
      case "providerFile":
        // 供应商文件除了路径还要换一次性 token，逻辑留在 desktop 模块内。
        run = async () => {
          const picked = await u.desktop.selectProviderFile(req);
          return { value: picked?.token ?? null, name: picked?.name };
        };
        break;
    }
    res.json(success({ id: startDesktopDialog(run) }));
  })
  .get("/", async (req, res) => {
    const state = readDesktopDialog(req.query.id);
    if (!state) return res.status(404).json(error("选择已失效，请重新打开", null, 404));
    res.json(success(state));
  });
