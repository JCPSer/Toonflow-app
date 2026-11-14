import { describe, expect, test } from "bun:test";
import { gridOutputOptions } from "./videoGrid";

describe("gridOutputOptions", () => {
  test("横屏 2×2：fps 采样、512×288 单格、tile=2x2、只取一帧", () => {
    const options = gridOutputOptions({ duration: 10, width: 1920, height: 1080, index: 2 }, 4);
    expect(options[options.indexOf("-frames:v") + 1]).toBe("1");
    expect(options[options.indexOf("-map") + 1]).toBe("0:2");
    const filter = options[options.indexOf("-vf") + 1];
    expect(filter).toContain("fps=0.500000");
    expect(filter).toContain("scale=512:288");
    expect(filter).toContain("pad=512:288");
    expect(filter).toContain("tile=2x2");
  });

  test("竖屏按实际画面算单格，流序号缺失时用大写 V 跳过封面图", () => {
    const options = gridOutputOptions({ duration: 5, width: 1080, height: 1920 }, 4);
    expect(options[options.indexOf("-map") + 1]).toBe("0:V:0");
    expect(options[options.indexOf("-vf") + 1]).toContain("scale=288:512");
  });
});
