import { describe, expect, it } from "bun:test";
import { canvasSchemas, canvasOperations } from "./runtime";

describe("canvas addNode 角色参数", () => {
  it("接受可选 roleId", () => {
    const args = canvasSchemas.addNode.parse({ type: "remote-agentNode", position: { x: 0, y: 0 }, roleId: "role-1" });
    expect(args.roleId).toBe("role-1");
    expect(canvasSchemas.addNode.parse({ type: "remote-agentNode", position: { x: 0, y: 0 } }).roleId).toBeUndefined();
  });

  it("拒绝超长 roleId 与未知字段", () => {
    expect(canvasSchemas.addNode.safeParse({ type: "a", position: { x: 0, y: 0 }, roleId: "x".repeat(65) }).success).toBe(false);
    expect(canvasSchemas.addNode.safeParse({ type: "a", position: { x: 0, y: 0 }, role: "导演" }).success).toBe(false);
  });

  it("getAgentRoles 无参并已注册为画布工具", () => {
    expect(canvasSchemas.getAgentRoles.parse({})).toEqual({});
    expect(canvasOperations.some(tool => tool.name === "getAgentRoles")).toBe(true);
  });
});
