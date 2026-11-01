import { Router } from "express";
import { z } from "zod";
import u from "@/utils";
import { agentLog } from "@/agentRuntime";
import { validateFields } from "@/lib/middleware";
import { error, success } from "@/lib/responseFormat";

export default Router().post("/", validateFields({
  text: z.string().optional(),
  format: z.literal("image").optional(),
  image: z.string().optional(),
}), async (req, res) => {
  const id = req.get("x-toonflow-clipboard-id") ?? "";
  agentLog("clipboard.write.request", {
    id, origin: req.get("origin"), referer: req.get("referer"), ua: req.get("user-agent"),
    length: typeof req.body.text === "string" ? req.body.text.length : -1, format: req.body.format ?? "text",
  });
  const desktop = u.desktop.getDesktopRuntime(req);
  try {
    if (req.body.format === "image") {
      if (!req.body.image) return res.status(400).json(error("缺少图片数据", null, 400));
      const png = await new Bun.Image(Buffer.from(req.body.image, "base64")).png().buffer();
      desktop.writeClipboardImage(new Uint8Array(png));
    } else if (typeof req.body.text === "string") {
      desktop.writeClipboardText(req.body.text);
    } else {
      return res.status(400).json(error("缺少剪贴板内容", null, 400));
    }
  } catch (cause) {
    agentLog("clipboard.write.error", { id, cause });
    throw cause;
  }
  // ACT: 只代表路由处理完成；原生 FFI 的写入结果不在返回值里，不能当成“系统剪贴板必然已更新”。
  agentLog("clipboard.write.done", { id });
  res.json(success());
});
