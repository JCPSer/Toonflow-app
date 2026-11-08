import { describe, expect, test } from "bun:test";

import { errorFromCause } from "./responseFormat";

// ACT: EBUSY 契约是客户端重试的唯一依据：HTTP 409 + data.code="EBUSY"。
// 改这里的映射前先确认 apps/web/src/lib/busyRetry.ts 仍然能识别。
describe("errorFromCause 文件冲突映射", () => {
  test("EBUSY 映射为 409，并保留 data.code", () => {
    const response = errorFromCause(Object.assign(new Error("文件正在使用"), { code: "EBUSY" }));
    expect(response.code).toBe(409);
    expect(response.data).toEqual({ code: "EBUSY" });
  });

  test("等待锁超时是 409 但不是可重试的 EBUSY", () => {
    const response = errorFromCause(Object.assign(new Error("等待操作超时"), { code: "EBUSYTIMEOUT" }));
    expect(response.code).toBe(409);
    expect((response.data as { code?: string } | null)?.code).toBe("EBUSYTIMEOUT");
  });

  test("EEXIST 仍是 409", () => {
    const response = errorFromCause(Object.assign(new Error("已存在"), { code: "EEXIST" }));
    expect(response.code).toBe(409);
    expect((response.data as { code?: string } | null)?.code).toBe("EEXIST");
  });

  test("未知错误保持 500", () => {
    expect(errorFromCause(new Error("boom")).code).toBe(500);
  });
});
