import { describe, expect, test } from "bun:test";

import { getNodeRun, hasNodeRun, registerNodeRun } from "@toonflow/nodes-scaffold/nodeRun";

describe("节点运行入口注册表", () => {
  test("注册后可按 nodeId 取到并执行", async () => {
    let calls = 0;
    const dispose = registerNodeRun("node-a", () => { calls++; });
    expect(hasNodeRun("node-a")).toBe(true);
    await getNodeRun("node-a")?.();
    expect(calls).toBe(1);
    dispose();
    expect(hasNodeRun("node-a")).toBe(false);
  });

  test("注销只清掉自己注册的那一份", () => {
    const first = registerNodeRun("node-b", () => {});
    const second = registerNodeRun("node-b", () => {});
    first();
    expect(getNodeRun("node-b")).toBeDefined();
    second();
    expect(getNodeRun("node-b")).toBeUndefined();
  });

  test("未注册的节点返回 undefined", () => {
    expect(getNodeRun("node-missing")).toBeUndefined();
    expect(hasNodeRun("node-missing")).toBe(false);
  });
});
