import { describe, expect, test } from "bun:test";
import {
  defaultGridCount,
  displaySize,
  frameFile,
  frameFilePattern,
  gridCell,
  gridFile,
  gridFilePattern,
  gridFilter,
  gridFps,
  gridLayout,
  gridSampleTimes,
  isGridCount,
  isStaleOutput,
  normalizeCaptureSeconds,
  readVideoMeta,
  streamRotation,
  temporaryFile,
  temporaryFilePattern,
  videoMapSpec,
} from "./inspectPlan";

describe("isGridCount / gridLayout", () => {
  test("只接受 4、9、16", () => {
    expect([4, 9, 16].every(isGridCount)).toBe(true);
    expect([0, 1, 6, 25, "9", undefined].some(isGridCount)).toBe(false);
    expect(defaultGridCount).toBe(9);
  });

  test("每档都是方阵且格数为帧数", () => {
    for (const count of [4, 9, 16] as const) {
      const { columns, rows } = gridLayout(count);
      expect(columns * rows).toBe(count);
      expect(columns).toBe(rows);
    }
  });
});

describe("gridSampleTimes", () => {
  test("按半格偏移均匀取值，首末都不贴边", () => {
    // 多采一帧：间隔 = 时长 / (帧数 + 1) = 1s，首格 0.5s、末格 8.5s。
    const times = gridSampleTimes(10, 9);
    expect(times).toHaveLength(9);
    expect(times[0]).toBe(0.5);
    expect(times.at(-1)).toBe(8.5);
    expect(times.every((time, index) => index === 0 || time > times[index - 1]!)).toBe(true);
  });

  test("时间点不超过时长", () => {
    for (const duration of [0.3, 1, 60, 3600]) {
      for (const count of [4, 9, 16] as const) {
        const times = gridSampleTimes(duration, count);
        expect(times).toHaveLength(count);
        expect(times.at(-1)!).toBeLessThan(duration);
      }
    }
  });

  test("输出帧率多留一帧余量", () => {
    expect(gridFps(10, 9)).toBeCloseTo(1);
    expect(gridFps(10, 4)).toBeCloseTo(0.5);
  });
});

describe("displaySize", () => {
  test("旋转 90°/270° 时交换宽高", () => {
    expect(displaySize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(displaySize(1920, 1080, -90)).toEqual({ width: 1080, height: 1920 });
    expect(displaySize(1920, 1080, 270)).toEqual({ width: 1080, height: 1920 });
  });

  test("0°/180° 与未知值保持原样", () => {
    expect(displaySize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(displaySize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 });
    expect(displaySize(1920, 1080, 45)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("gridCell", () => {
  test("横屏按 16:9 出 512×288，竖屏按 9:16 出 288×512", () => {
    expect(gridCell(1920, 1080)).toEqual({ width: 512, height: 288 });
    expect(gridCell(1080, 1920)).toEqual({ width: 288, height: 512 });
  });

  test("方形与极端比例都保持长边 512、短边为偶数且不小于下限", () => {
    expect(gridCell(1000, 1000)).toEqual({ width: 512, height: 512 });
    const wide = gridCell(4000, 100);
    expect(wide.width).toBe(512);
    expect(wide.height % 2).toBe(0);
    expect(wide.height).toBeGreaterThanOrEqual(64);
  });
});

describe("gridFilter", () => {
  test("滤镜链包含 fps、等比缩放、补边与拼图", () => {
    const filter = gridFilter(9, 9, { width: 512, height: 288 });
    expect(filter).toContain("fps=1.111111");
    expect(filter).toContain("scale=512:288:force_original_aspect_ratio=decrease,setsar=1");
    expect(filter).toContain("pad=512:288:(ow-iw)/2:(oh-ih)/2:color=black");
    expect(filter).toContain("tile=3x3");
  });

  test("各档拼图行列与帧数一致", () => {
    const cell = { width: 512, height: 288 };
    expect(gridFilter(10, 4, cell)).toContain("tile=2x2");
    expect(gridFilter(10, 16, cell)).toContain("tile=4x4");
  });
});

describe("文件名与清理规则", () => {
  test("宫格与单帧可区分，且各自可被清理规则匹配", () => {
    expect(gridFile(9)).toBe("contact-9.jpg");
    expect(frameFile(3.2)).toBe("frame-3200ms.jpg");
    expect(frameFile(3.204)).toBe("frame-3200ms.jpg");
    expect(gridFilePattern.test(gridFile(16))).toBe(true);
    expect(frameFilePattern.test(frameFile(0))).toBe(true);
  });

  test("临时文件带随机名并命中临时清理规则", () => {
    const temp = temporaryFile("assets/a/inspect", "contact-9");
    expect(temp.startsWith("assets/a/inspect/.contact-9.")).toBe(true);
    expect(temporaryFilePattern.test(temp)).toBe(true);
    expect(temp).not.toBe(temporaryFile("assets/a/inspect", "contact-9"));
  });
});

describe("normalizeCaptureSeconds", () => {
  test("去重、排序并按百分秒取整", () => {
    expect(normalizeCaptureSeconds([3, 1.004, 3, 2], 10)).toEqual([1, 2, 3]);
  });

  test("越界、负数、超过 6 个都拒绝", () => {
    expect(() => normalizeCaptureSeconds([10], 10)).toThrow();
    expect(() => normalizeCaptureSeconds([-1], 10)).toThrow();
    expect(() => normalizeCaptureSeconds([0, 1, 2, 3, 4, 5, 6], 10)).toThrow();
    expect(() => normalizeCaptureSeconds([], 10)).toThrow();
  });

  test("四舍五入后越界的值也拒绝", () => {
    expect(() => normalizeCaptureSeconds([9.999], 10)).toThrow();
    expect(normalizeCaptureSeconds([9.994], 10)).toEqual([9.99]);
  });

  test("6 个点正好可用", () => {
    expect(normalizeCaptureSeconds([0, 1, 2, 3, 4, 5], 10)).toHaveLength(6);
  });
});

describe("streamRotation / readVideoMeta", () => {
  test("读旧版 tags.rotate 与新版 side_data rotation", () => {
    expect(streamRotation({ tags: { rotate: "90" } })).toBe(90);
    expect(streamRotation({ side_data_list: [{ rotation: -90 }] })).toBe(-90);
    expect(streamRotation({ tags: { rotate: "0" }, side_data_list: [{ rotation: 270 }] })).toBe(270);
    expect(streamRotation({})).toBe(0);
  });

  test("旋转视频按实际画面返回宽高", () => {
    const meta = readVideoMeta({
      format: { duration: "10.0" },
      streams: [{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{ rotation: 90 }] }],
    });
    expect(meta).toEqual({ duration: 10, width: 1080, height: 1920 });
  });

  test("忽略封面图并回退到流层时长", () => {
    const meta = readVideoMeta({
      streams: [
        { codec_type: "video", width: 600, height: 600, disposition: { attached_pic: 1 } },
        { codec_type: "video", width: 720, height: 1280, duration: 5 },
      ],
    });
    expect(meta).toEqual({ duration: 5, width: 720, height: 1280 });
  });

  test("音轨比画面长时取视频流时长，不吃容器的更长时长", () => {
    const meta = readVideoMeta({
      format: { duration: "12.5" },
      streams: [{ codec_type: "video", width: 720, height: 1280, duration: 10 }],
    });
    expect(meta.duration).toBe(10);
  });

  test("流选择按 ffprobe 序号，序号缺失时用大写 V 跳过封面图", () => {
    expect(videoMapSpec({ index: 2 })).toBe("0:2");
    expect(videoMapSpec({})).toBe("0:V:0");
  });

  test("没有画面或没有时长时报可读错误", () => {
    expect(() => readVideoMeta({ streams: [{ codec_type: "audio" }] })).toThrow("文件里没有可用的视频画面");
    expect(() => readVideoMeta({ streams: [{ codec_type: "video", width: 1, height: 1 }] })).toThrow("无法读取视频时长");
  });
});

describe("isStaleOutput", () => {
  test("同类旧产物与上一轮残留的临时文件都该清", () => {
    expect(isStaleOutput(gridFile(9), gridFilePattern)).toBe(true);
    expect(isStaleOutput(".contact-9.abc.tmp.jpg", gridFilePattern)).toBe(true);
  });

  test("本次正在写的临时文件不能被清掉", () => {
    // ACT: 回归用例：清理规则曾把刚写好的临时文件一起删掉，随后结算误报「未生成文件 / 帧数不足」。
    expect(isStaleOutput(".contact-9.abc.tmp.jpg", gridFilePattern, ".contact-9.abc.tmp.jpg")).toBe(false);
  });

  test("其它产物与无关文件不动", () => {
    expect(isStaleOutput(frameFile(3), gridFilePattern)).toBe(false);
    expect(isStaleOutput("g1.jpg", gridFilePattern)).toBe(false);
    expect(isStaleOutput(gridFile(9), frameFilePattern)).toBe(false);
  });
});
