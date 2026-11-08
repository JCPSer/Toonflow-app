import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAssetEntry } from "./library";

const library = (root: string) => ({ kind: "global" as const, root, relativePath: "" });
// macOS 的 tmpdir 经过 /private 符号链接，root 必须是 realpath 才能通过工作区边界校验。
const makeRoot = async () => await realpath(await mkdtemp(join(tmpdir(), "toonflow-asset-read-")));

describe("readAssetEntry 并发读取", () => {
  test("同一素材并发读取都成功，revision 一致且各自带回自己的路径", async () => {
    const root = await makeRoot();
    try {
      await writeFile(join(root, "a.txt"), "hello");
      const [first, second] = await Promise.all([
        readAssetEntry(library(root), "a.txt"),
        readAssetEntry(library(root), "a.txt"),
      ]);
      expect(first.revision).toBe(second.revision);
      expect(new TextDecoder().decode(first.content)).toBe("hello");
      expect(new TextDecoder().decode(second.content)).toBe("hello");
      expect(first.path).toBe("a.txt");
      expect(second.path).toBe("a.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("一个调用方取消不影响另一个调用方", async () => {
    const root = await makeRoot();
    const controller = new AbortController();
    try {
      await writeFile(join(root, "a.txt"), "hello");
      const aborted = readAssetEntry(library(root), "a.txt", controller.signal);
      controller.abort();
      const kept = readAssetEntry(library(root), "a.txt");
      await expect(aborted).rejects.toThrow();
      await expect(kept).resolves.toMatchObject({ path: "a.txt" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
