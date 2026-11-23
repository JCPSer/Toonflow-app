import { describe, expect, it } from "bun:test";
import { createLruCache } from "./lruCache";

describe("createLruCache", () => {
  it("超过容量时淘汰最久未使用的键", () => {
    const cache = createLruCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // a 变为最近使用
    cache.set("c", 3); // b 最久未用
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("重复写同一键只保留最新值", () => {
    const cache = createLruCache<string, number>(3);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("TTL 过期后返回 undefined，读取不续期", async () => {
    const cache = createLruCache<string, number>(4, 40);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("delete 与 clear 生效", () => {
    const cache = createLruCache<string, number>(4);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.keys()).toEqual(["b"]);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("容量下限为 1", () => {
    const cache = createLruCache<string, number>(0);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.keys()).toEqual(["b"]);
  });
});
