import { readdir, realpath } from "@toonflow/file";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Router } from "express";
import { error, success } from "@/lib/responseFormat";

const router = Router();

// ACT: 桌面端本地目录浏览。macOS 的系统原生面板由 osascript 子进程弹出，界面固定英文、位置也不受控，
// 因此改用应用内的选择器遍历本地磁盘。这里只返回目录（选的是工作目录），并按名称排序。
export default router.post("/", async (req, res) => {
  if (!req.app.locals.desktop) return res.status(404).json(error("此接口仅在桌面客户端中可用", null, 404));
  const input = typeof req.body?.path === "string" ? req.body.path.trim() : "";
  let absolute: string;
  try {
    absolute = await realpath(input ? resolve(input) : homedir());
  } catch {
    return res.status(404).json(error("目录不存在或无法访问", null, 404));
  }
  let entries: { name: string; absolutePath: string }[];
  try {
    entries = (await readdir(absolute, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => ({ name: entry.name, absolutePath: join(absolute, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
  } catch {
    return res.status(403).json(error("没有权限访问此目录", null, 403));
  }
  const parent = dirname(absolute);
  res.set("Cache-Control", "no-store").json(success({ absolutePath: absolute, parent: parent === absolute ? null : parent, home: homedir(), entries }));
});
