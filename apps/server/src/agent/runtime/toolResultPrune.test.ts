import { describe, expect, test } from "bun:test";
import { PRUNE_MIN_CHARS, pruneBoundary, pruneSessionEntries, pruneToolResultMessage } from "./toolResultPrune";

const long = (n: number) => "x".repeat(n);
const toolMessage = (text: string, extra: Record<string, unknown> = {}) => ({
  role: "toolResult", toolName: "read", content: [{ type: "text", text }], ...extra,
}) as never;

describe("pruneToolResultMessage", () => {
  test("长结果淘汰成一行指针", () => {
    const result = pruneToolResultMessage(toolMessage(long(PRUNE_MIN_CHARS + 1)));
    expect(result.pruned).toBe(true);
    expect(JSON.stringify(result.message.content)).toContain("工具结果已裁剪：read");
  });

  test("短结果 / 错误 / 无工具名 / 已是指针 / 非工具结果都保留", () => {
    expect(pruneToolResultMessage(toolMessage(long(PRUNE_MIN_CHARS - 1))).pruned).toBe(false);
    expect(pruneToolResultMessage(toolMessage(long(2000), { isError: true })).pruned).toBe(false);
    expect(pruneToolResultMessage({ role: "toolResult", content: [{ type: "text", text: long(2000) }] } as never).pruned).toBe(false);
    expect(pruneToolResultMessage(toolMessage("[工具结果已裁剪：read，约 2000 字符；……]")).pruned).toBe(false);
    expect(pruneToolResultMessage({ role: "assistant", content: [{ type: "text", text: long(2000) }] } as never).pruned).toBe(false);
  });

  test("旧的没有 content 数组的条目直接放过", () => {
    expect(pruneToolResultMessage({ role: "toolResult", toolName: "read" } as never).pruned).toBe(false);
  });

  test("图片块保留原位", () => {
    const result = pruneToolResultMessage({
      role: "toolResult", toolName: "read",
      content: [{ type: "text", text: long(2000) }, { type: "image", data: "a", mimeType: "image/png" }],
    } as never);
    expect(result.pruned).toBe(true);
    expect((result.message.content as unknown as { type: string }[]).some((part) => part.type === "image")).toBe(true);
  });
});

describe("pruneBoundary", () => {
  test("不足 4 个用户轮不淘汰", () => {
    expect(pruneBoundary(["user", "toolResult", "user", "toolResult", "user", "toolResult"])).toBe(0);
  });

  test("4 个用户轮时边界落在第 4 近的 user 之后", () => {
    expect(pruneBoundary(["user", "toolResult", "user", "t", "user", "t", "user", "t"])).toBe(1);
  });
});

describe("pruneSessionEntries", () => {
  type Row = { type: string; id: string; parentId?: string; message?: { role: string; content?: unknown } };
  const entries: Row[] = [{ type: "session", id: "h" }];
  for (let turn = 1; turn <= 5; turn++) {
    entries.push({ type: "message", id: `u${turn}`, parentId: turn === 1 ? "h" : `t${turn - 1}`, message: { role: "user", content: `q${turn}` } });
    entries.push({ type: "message", id: `t${turn}`, parentId: `u${turn}`, message: toolMessage(`${turn}${long(1000)}`) as Row["message"] });
  }

  test("只淘汰边界之前的结果，结构与分支链不变", () => {
    const result = pruneSessionEntries(entries);
    expect(result.pruned).toBe(1);
    expect(result.entries.map((entry) => entry.id)).toEqual(entries.map((entry) => entry.id));
    expect(result.entries.map((entry) => entry.parentId)).toEqual(entries.map((entry) => entry.parentId));
    expect(JSON.stringify(result.entries.slice(-6))).toBe(JSON.stringify(entries.slice(-6)));
  });

  test("重复执行幂等", () => {
    expect(pruneSessionEntries(pruneSessionEntries(entries).entries).pruned).toBe(0);
  });

  test("按当前分支算边界，不被回退留下的旧分支带偏", () => {
    // 当前分支：u1 t1 u2 t2 u3 t3 u4b t4b（从 u3 之后重发），文件里还留着旧分支的 u4 t4 u5 t5
    const resent = ["u1", "t1", "u2", "t2", "u3", "t3", "u4b", "t4b"];
    const all: Row[] = [
      ...entries,
      { type: "message", id: "u4b", parentId: "t3", message: { role: "user", content: "q4b" } },
      { type: "message", id: "t4b", parentId: "u4b", message: toolMessage(`4b${long(1000)}`) as Row["message"] },
    ];
    // 按整个文件数：旧分支的 user 把边界推到 u3 之后，连 t1/t2 都要淘汰
    expect(pruneSessionEntries(all).pruned).toBe(2);
    // 按当前分支数：边界落在 u1 之后，还没有可淘汰的工具结果
    const onBranch = pruneSessionEntries(all, resent);
    expect(onBranch.pruned).toBe(0);
    // 旧分支的条目即使被判定为可淘汰，也不会因为「不在当前分支」被动到
    const deadIds = onBranch.entries.filter((entry) => entry.id && ["u4", "t4", "u5", "t5"].includes(entry.id));
    expect(deadIds.length).toBe(4);
  });
});
