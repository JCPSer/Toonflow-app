import { describe, expect, it } from "bun:test";
import { agentRolesSchema, composeRolePrompt, sanitizeAgentRoles } from "./roles";

describe("composeRolePrompt", () => {
  it("角色提示词排在最前并声明优先", () => {
    const text = composeRolePrompt("你是提示词审核员。", "默认系统提示");
    expect(text.startsWith("## 角色设定（优先）\n你是提示词审核员。")).toBe(true);
    expect(text).toContain("以本段为准");
    expect(text.indexOf("你是提示词审核员。")).toBeLessThan(text.indexOf("默认系统提示"));
  });

  it("没有角色时原样返回默认提示", () => {
    expect(composeRolePrompt(undefined, "默认")).toBe("默认");
    expect(composeRolePrompt("   ", "默认")).toBe("默认");
  });
});

describe("sanitizeAgentRoles", () => {
  it("丢弃坏项、去重 id、截断超长提示词", () => {
    const roles = sanitizeAgentRoles([
      { id: "a", name: " 导演 ", prompt: " 负责分镜 " },
      { id: "a", name: "重复", prompt: "p" },
      { id: "", name: "无 id", prompt: "p" },
      { id: "b", name: " ", prompt: "p" },
      { id: "c", name: "超长", prompt: "x".repeat(25000) },
      null,
      "nope",
    ]);
    expect(roles.map(role => role.id)).toEqual(["a", "c"]);
    expect(roles[0]!.name).toBe("导演");
    expect(roles[0]!.prompt).toBe("负责分镜");
    expect(roles[1]!.prompt.length).toBe(20000);
  });

  it("非数组返回空", () => {
    expect(sanitizeAgentRoles(undefined)).toEqual([]);
    expect(sanitizeAgentRoles({ id: "a" })).toEqual([]);
  });
});

describe("agentRolesSchema", () => {
  it("接受合法角色并拒绝超长名称", () => {
    expect(agentRolesSchema.parse([{ id: "a", name: "导演", prompt: "负责分镜" }])).toHaveLength(1);
    expect(agentRolesSchema.safeParse([{ id: "a", name: "x".repeat(41), prompt: "p" }]).success).toBe(false);
    expect(agentRolesSchema.safeParse([{ id: "", name: "a", prompt: "p" }]).success).toBe(false);
  });

  it("拒绝超过 50 个角色", () => {
    const many = Array.from({ length: 51 }, (_, index) => ({ id: `r${index}`, name: `角色${index}`, prompt: "p" }));
    expect(agentRolesSchema.safeParse(many).success).toBe(false);
  });
});
