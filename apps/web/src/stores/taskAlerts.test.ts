import { describe, expect, test } from "bun:test";
import { formatTaskAlertTime } from "./taskAlerts";

const at = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute).getTime();

describe("formatTaskAlertTime", () => {
  const now = at(2026, 11, 2, 15, 30);

  test("今天只显示小时和分钟", () => {
    expect(formatTaskAlertTime(at(2026, 11, 2, 9, 5), now)).toBe("09:05");
    expect(formatTaskAlertTime(at(2026, 11, 2, 0, 0), now)).toBe("00:00");
  });

  test("昨天加「昨天」前缀", () => {
    expect(formatTaskAlertTime(at(2026, 11, 1, 23, 59), now)).toBe("昨天 23:59");
  });

  test("更早显示月日和小时分钟", () => {
    expect(formatTaskAlertTime(at(2026, 10, 30, 14, 0), now)).toBe("10-30 14:00");
  });

  test("按本地日历天判断，而不是 24 小时", () => {
    const justAfterMidnight = at(2026, 11, 2, 0, 10);
    expect(formatTaskAlertTime(at(2026, 11, 2, 0, 5), justAfterMidnight)).toBe("00:05");
    expect(formatTaskAlertTime(at(2026, 11, 1, 23, 59), justAfterMidnight)).toBe("昨天 23:59");
  });

  test("非法时间返回空串", () => {
    expect(formatTaskAlertTime(Number.NaN, now)).toBe("");
  });
});
