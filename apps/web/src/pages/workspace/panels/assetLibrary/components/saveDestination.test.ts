import { describe, expect, test } from "bun:test";
import { resolveSaveDestination } from "./saveDestination";

describe("resolveSaveDestination", () => {
  test("有记忆且目标库可用时原样回填", () => {
    expect(resolveSaveDestination({
      defaults: { library: "project", path: "主图/2026" },
      library: "global",
      directory: "/project",
      fallbackPath: "当前目录",
    })).toEqual({ library: "project", path: "主图/2026" });
  });

  test("没有记忆时回落到当前浏览库与默认路径", () => {
    expect(resolveSaveDestination({ library: "global", directory: "/project", fallbackPath: "" }))
      .toEqual({ library: "global", path: "" });
  });

  test("没有项目目录时不能用项目库", () => {
    expect(resolveSaveDestination({ library: "project", fallbackPath: "" }))
      .toEqual({ library: "global", path: "" });
  });

  test("记忆了项目库但没有项目目录：目标库与保存位置一起回落", () => {
    expect(resolveSaveDestination({
      defaults: { library: "project", path: "主图/2026" },
      library: "project",
      directory: undefined,
      fallbackPath: "",
    })).toEqual({ library: "global", path: "" });
  });

  test("无记忆时项目入口回落到项目库根目录", () => {
    expect(resolveSaveDestination({ library: "project", directory: "/project", fallbackPath: "" }))
      .toEqual({ library: "project", path: "" });
  });
});
