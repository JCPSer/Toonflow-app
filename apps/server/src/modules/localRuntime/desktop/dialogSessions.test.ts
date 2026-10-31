import { describe, expect, test } from "bun:test";
import { readDesktopDialog, startDesktopDialog } from "./dialogSessions";

/** 让 startDesktopDialog 里的 Promise 链跑完。 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("desktop dialog sessions", () => {
  test("start 立即返回 id，结果在 run 完成后可取", async () => {
    let finish: ((value: { value: string | null }) => void) | undefined;
    const id = startDesktopDialog(() => new Promise(resolve => { finish = resolve; }));
    expect(typeof id).toBe("string");
    // 对话框还没关：会话存在但未完成。
    expect(readDesktopDialog(id)).toEqual({ done: false });
    finish?.({ value: "/tmp/picked" });
    await flush();
    expect(readDesktopDialog(id)).toEqual({ done: true, value: "/tmp/picked" });
  });

  test("用户取消时 value 为 null（不是错误）", async () => {
    const id = startDesktopDialog(async () => ({ value: null }));
    await flush();
    const state = readDesktopDialog(id);
    expect(state?.done).toBe(true);
    expect(state?.value).toBeNull();
    expect(state?.error).toBeUndefined();
  });

  test("运行中不允许开第二个对话框", async () => {
    let finish: ((value: { value: string | null }) => void) | undefined;
    const first = startDesktopDialog(() => new Promise(resolve => { finish = resolve; }));
    expect(() => startDesktopDialog(async () => ({ value: null }))).toThrow("已有选择窗口正在操作");
    finish?.({ value: null });
    await flush();
    // 第一个结束后可以再开。
    const second = startDesktopDialog(async () => ({ value: "/tmp/again" }));
    await flush();
    expect(readDesktopDialog(second)?.value).toBe("/tmp/again");
    expect(readDesktopDialog(first)?.done).toBe(true);
  });

  test("失败会把可读文案写进会话，而不是抛出", async () => {
    const id = startDesktopDialog(async () => { throw new Error("缺少 macOS 选择器"); });
    await flush();
    const state = readDesktopDialog(id);
    expect(state?.done).toBe(true);
    expect(state?.error).toBe("缺少 macOS 选择器");
    expect(state?.value).toBeUndefined();
  });

  test("未知 id 返回 undefined，交给前端按「已失效」处理", () => {
    expect(readDesktopDialog("not-a-session")).toBeUndefined();
    expect(readDesktopDialog(undefined)).toBeUndefined();
    expect(readDesktopDialog(42)).toBeUndefined();
  });

  test("结果可被重复轮询读取", async () => {
    const id = startDesktopDialog(async () => ({ value: "/tmp/x", name: "x.ts" }));
    await flush();
    expect(readDesktopDialog(id)).toEqual({ done: true, value: "/tmp/x", name: "x.ts" });
    expect(readDesktopDialog(id)).toEqual({ done: true, value: "/tmp/x", name: "x.ts" });
  });
});
