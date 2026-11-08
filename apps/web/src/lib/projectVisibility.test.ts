import { describe, expect, test } from "bun:test";

import { filterVisibleProjects, isProjectHidden, projectVisible } from "./projectVisibility";

const list = [
  { directory: "/tmp/normal", name: "普通", lastOpenedAt: 1 },
  { directory: "/tmp/secret", name: "隐私", lastOpenedAt: 2, hidden: true },
  { directory: "/tmp/false-flag", name: "显式 false", lastOpenedAt: 3, hidden: false },
];

describe("隐藏项目判定", () => {
  test("只认 hidden === true", () => {
    expect(isProjectHidden(list[1]!)).toBe(true);
    expect(isProjectHidden(list[0]!)).toBe(false);
    expect(isProjectHidden(list[2]!)).toBe(false);
  });

  test("锁定态隐藏项目不可见，解锁后可见", () => {
    expect(projectVisible(list[1]!, false)).toBe(false);
    expect(projectVisible(list[1]!, true)).toBe(true);
    expect(projectVisible(list[0]!, false)).toBe(true);
  });

  test("锁定态过滤掉隐藏项目，普通项目与显式 false 保留", () => {
    expect(filterVisibleProjects(list, false).map(item => item.name)).toEqual(["普通", "显式 false"]);
  });

  test("解锁后返回原列表（同一引用，不做多余拷贝）", () => {
    expect(filterVisibleProjects(list, true)).toBe(list);
  });

  test("临时列表不会被改写", () => {
    const locked = filterVisibleProjects(list, false);
    expect(list).toHaveLength(3);
    expect(locked).not.toBe(list);
  });
});
