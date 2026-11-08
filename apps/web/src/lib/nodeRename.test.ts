import { describe, expect, test } from "bun:test";

import { getNodeRename, hasNodeRename, registerNodeRename } from "@toonflow/nodes-scaffold/nodeRename";

describe("节点重命名入口注册表", () => {
  test("注册后可按 nodeId 取到并执行", async () => {
    let calls = 0;
    const dispose = registerNodeRename("rename-a", () => { calls++; });
    expect(hasNodeRename("rename-a")).toBe(true);
    await getNodeRename("rename-a")?.();
    expect(calls).toBe(1);
    dispose();
    expect(hasNodeRename("rename-a")).toBe(false);
  });

  test("注销只清掉自己注册的那一份", () => {
    const first = registerNodeRename("rename-b", () => {});
    const second = registerNodeRename("rename-b", () => {});
    first();
    expect(getNodeRename("rename-b")).toBeDefined();
    second();
    expect(getNodeRename("rename-b")).toBeUndefined();
  });

  test("未注册的节点返回 undefined", () => {
    expect(getNodeRename("rename-missing")).toBeUndefined();
    expect(hasNodeRename("rename-missing")).toBe(false);
  });
});
