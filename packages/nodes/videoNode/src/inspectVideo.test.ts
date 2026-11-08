import { describe, expect, test } from "bun:test";
import type { WorkspaceFiles } from "@toonflow/nodes-scaffold/runtime";
import { clearOutputs, settleOutput } from "./inspectVideo";
import { frameFile, gridFile, gridFilePattern, frameFilePattern } from "./inspectPlan";

type Entry = { name: string; path: string; type: "file" | "directory" };

const directory = "assets/node-1/inspect";

function pathOf(name: string) {
  return `${directory}/${name}`;
}

function entry(name: string): Entry {
  return { name, path: pathOf(name), type: "file" };
}

/** 只实现被测函数用到的方法；`hidden` 用来模拟目录列表滞后于写入。 */
function fakeFiles(initial: Entry[], hidden: string[] = []) {
  const entries = new Map(initial.map(item => [item.path, item]));
  const removed: string[] = [];
  const renamed: [string, string][] = [];
  const read: string[] = [];
  const files = {
    async list() {
      return {
        directory,
        empty: entries.size === 0,
        entries: [...entries.values()].filter(item => !hidden.includes(item.name)),
      };
    },
    async remove(path: string) {
      removed.push(path);
      entries.delete(path);
    },
    async rename(from: string, to: string) {
      const source = entries.get(from);
      if (!source) throw Object.assign(new Error("未找到文件"), { code: "ENOENT" });
      if (entries.has(to)) throw Object.assign(new Error("已存在同名文件"), { code: "EEXIST" });
      entries.delete(from);
      entries.set(to, { name: to.slice(to.lastIndexOf("/") + 1), path: to, type: "file" });
      renamed.push([from, to]);
    },
    async read(path: string) {
      read.push(path);
      if (!entries.has(path)) throw Object.assign(new Error("未找到文件"), { code: "ENOENT" });
      return new ArrayBuffer(0);
    },
  };
  return { files: files as unknown as WorkspaceFiles, entries, removed, renamed, read };
}

describe("clearOutputs", () => {
  test("清掉旧宫格与残留临时文件，保留本次临时文件", async () => {
    const temporary = pathOf(".contact-9.new.tmp.jpg");
    const fake = fakeFiles([
      entry(gridFile(9)),
      entry(gridFile(16)),
      entry(".contact-9.old.tmp.jpg"),
      entry(".contact-9.new.tmp.jpg"),
      entry(frameFile(3)),
    ]);
    await clearOutputs(fake.files, directory, gridFilePattern, temporary);
    expect([...fake.entries.keys()].sort()).toEqual([pathOf(".contact-9.new.tmp.jpg"), pathOf(frameFile(3))].sort());
  });

  test("宫格清理不动单帧产物，单帧清理不动宫格", async () => {
    const fake = fakeFiles([entry(gridFile(9)), entry(frameFile(3))]);
    await clearOutputs(fake.files, directory, frameFilePattern);
    expect(fake.entries.has(pathOf(gridFile(9)))).toBe(true);
    expect(fake.entries.has(pathOf(frameFile(3)))).toBe(false);
  });
});

describe("settleOutput", () => {
  test("临时文件存在时删旧目标并改名", async () => {
    const temporary = pathOf(".contact-9.new.tmp.jpg");
    const fake = fakeFiles([entry(gridFile(9)), entry(".contact-9.new.tmp.jpg")]);
    await settleOutput(fake.files, directory, temporary, pathOf(gridFile(9)));
    expect([...fake.entries.keys()]).toEqual([pathOf(gridFile(9))]);
    expect(fake.renamed).toEqual([[temporary, pathOf(gridFile(9))]]);
  });

  test("临时文件不存在时报帧数不足，且不删除上一轮可用产物", async () => {
    // ACT: 回归用例：早期实现先删目标再改名，新图失败时上一张宫格也一起没了。
    const fake = fakeFiles([entry(gridFile(9))]);
    await expect(settleOutput(fake.files, directory, pathOf(".contact-9.new.tmp.jpg"), pathOf(gridFile(9))))
      .rejects.toThrow("未生成文件（视频时长或可用帧数不足）");
    expect(fake.entries.has(pathOf(gridFile(9)))).toBe(true);
    expect(fake.removed).toEqual([]);
  });

  test("目录列表滞后但文件已写出时不误报", async () => {
    const temporary = pathOf(".contact-9.new.tmp.jpg");
    const fake = fakeFiles([entry(".contact-9.new.tmp.jpg")], [".contact-9.new.tmp.jpg"]);
    await settleOutput(fake.files, directory, temporary, pathOf(gridFile(9)));
    expect(fake.read).toContain(temporary);
    expect(fake.renamed).toEqual([[temporary, pathOf(gridFile(9))]]);
  });
});
