import { describe, expect, it } from "bun:test";
import { dispatchDepthSchema } from "./dispatchDepthSchema";

describe("dispatchDepthSchema", () => {
  it("允许 0 到不限制档的绝对上限 1000", () => {
    for (const value of [0, 8, 32, 200, 1000]) expect(dispatchDepthSchema.safeParse(value).success).toBe(true);
    expect(dispatchDepthSchema.safeParse(undefined).success).toBe(true);
  });

  it("拒绝负数、超过 1000 与非整数", () => {
    for (const value of [-1, 1001, 1.5, "8"]) expect(dispatchDepthSchema.safeParse(value).success).toBe(false);
  });
});
