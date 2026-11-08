import { describe, expect, test } from "bun:test";
import { bumpFileVersion, fileVersion, fileVersionKey, normalizeWorkspacePath } from "./fileVersions";

describe("fileVersions", () => {
  test("没写过就是 0", () => {
    expect(fileVersion("/tmp/proj-a", "assets/node-1/frame-first.jpg")).toBe(0);
  });

  test("只递增被改写的那一条路径", () => {
    const directory = "/tmp/proj-b";
    bumpFileVersion(directory, "assets/node-1/frame-first.jpg");
    bumpFileVersion(directory, "assets/node-1/frame-first.jpg");
    expect(fileVersion(directory, "assets/node-1/frame-first.jpg")).toBe(2);
    expect(fileVersion(directory, "assets/node-1/frame-last.jpg")).toBe(0);
    expect(fileVersion(directory, "assets/node-2/frame-first.jpg")).toBe(0);
  });

  test("不同目录互不影响", () => {
    bumpFileVersion("/tmp/proj-c", "assets/n/frame-first.jpg");
    expect(fileVersion("/tmp/proj-c", "assets/n/frame-first.jpg")).toBe(1);
    expect(fileVersion("/tmp/proj-d", "assets/n/frame-first.jpg")).toBe(0);
  });

  test("分隔符、大小写与空段归一后再比较", () => {
    bumpFileVersion("/tmp/proj-e", "assets\\node/Foo.jpg");
    expect(fileVersion("/tmp/proj-e/", "./assets//node/foo.jpg")).toBe(1);
  });

  test("key 是归一化的目录与路径拼接", () => {
    expect(fileVersionKey("/tmp/proj-f/", "./a//b.png")).toBe(`${normalizeWorkspacePath("/tmp/proj-f")}\0a/b.png`);
  });
});
