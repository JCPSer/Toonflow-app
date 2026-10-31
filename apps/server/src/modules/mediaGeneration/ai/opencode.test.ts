import { describe, expect, test } from "bun:test";
import { isOpenCodeApi, openCodeRequestHeaders } from "./opencode";

describe("isOpenCodeApi", () => {
  test("命中 opencode.ai 主机（大小写、端口、路径、查询、根域尾点都不影响）", () => {
    expect(isOpenCodeApi("https://opencode.ai/zen/go/v1")).toBe(true);
    expect(isOpenCodeApi("https://opencode.ai")).toBe(true);
    expect(isOpenCodeApi("https://OPENCODE.AI/zen/go/v1")).toBe(true);
    expect(isOpenCodeApi("https://opencode.ai:8443/zen/go/v1")).toBe(true);
    expect(isOpenCodeApi("https://opencode.ai/zen/go/v1?x=1#top")).toBe(true);
    expect(isOpenCodeApi("https://opencode.ai./zen/go/v1")).toBe(true);
  });

  test("不命中仿冒域名、子域与其他供应商", () => {
    expect(isOpenCodeApi("https://opencode.ai.evil.com/v1")).toBe(false);
    expect(isOpenCodeApi("https://api.opencode.ai/v1")).toBe(false);
    expect(isOpenCodeApi("https://notopencode.ai/v1")).toBe(false);
    expect(isOpenCodeApi("http://127.0.0.1:8787/v1")).toBe(false);
    expect(isOpenCodeApi("https://api.deepseek.com/v1")).toBe(false);
    expect(isOpenCodeApi("not a url")).toBe(false);
  });
});

describe("openCodeRequestHeaders", () => {
  test("非 OpenCode 地址不注入任何头", () => {
    expect(openCodeRequestHeaders("https://api.deepseek.com/v1")).toBeUndefined();
  });

  test("只注入会话与客户端标识，不碰鉴权头", () => {
    const headers = openCodeRequestHeaders("https://opencode.ai/zen/go/v1", "0199-uuid");
    expect(headers).toEqual({ "x-opencode-session": "0199-uuid", "x-opencode-client": "pi" });
  });

  test("调用方会话 ID 前后空白会被裁掉", () => {
    const headers = openCodeRequestHeaders("https://opencode.ai/zen/go/v1", "  run-1  ");
    expect(headers?.["x-opencode-session"]).toBe("run-1");
  });

  test.each(["", "   ", undefined])("缺省或空串会话（%p）退回 uuidv7", sessionId => {
    const headers = openCodeRequestHeaders("https://opencode.ai/zen/go/v1", sessionId);
    expect(headers?.["x-opencode-session"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("两次随机生成的会话 ID 不同", () => {
    const first = openCodeRequestHeaders("https://opencode.ai/zen/go/v1")!;
    const second = openCodeRequestHeaders("https://opencode.ai/zen/go/v1")!;
    expect(first["x-opencode-session"]).not.toBe(second["x-opencode-session"]);
  });
});
