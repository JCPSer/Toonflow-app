import { describe, expect, test } from "bun:test";
import { buildFrameHandles, enabledFrameOutputs, frameOutputMeta, frameOutputOptions, JPEG_OUTPUT_OPTIONS, staticNodeHandles } from "./frameOutputPlan";

const base = [
  { id: "in", type: "target" as const, dataType: "IMAGE" as const },
  { id: "video", type: "source" as const, dataType: "VIDEO" as const },
];

describe("buildFrameHandles", () => {
  test("全关时与声明期端口一致", () => {
    expect(buildFrameHandles(undefined, base)).toEqual(base);
    expect(buildFrameHandles({}, base)).toEqual(base);
    expect(buildFrameHandles({ first: false, last: false }, base)).toEqual(base);
  });

  test("只开首帧时只多出 firstFrame", () => {
    const handles = buildFrameHandles({ first: true }, base);
    expect(handles.map((item) => item.id)).toEqual(["in", "video", "firstFrame"]);
    expect(handles.at(-1)).toMatchObject({ type: "source", dataType: "IMAGE", label: "首帧输出" });
  });

  test("两项都开时顺序固定为首帧在前、尾帧在后", () => {
    expect(buildFrameHandles({ first: true, last: true }, base).map((item) => item.id)).toEqual(["in", "video", "firstFrame", "lastFrame"]);
    expect(buildFrameHandles({ last: true, first: true }, base).map((item) => item.id)).toEqual(["in", "video", "firstFrame", "lastFrame"]);
  });

  test("关闭尾帧后端口上移，不占位", () => {
    const before = buildFrameHandles({ first: true, last: true }, base);
    expect(before).toHaveLength(4);
    expect(buildFrameHandles({ first: true }, base)).toHaveLength(3);
  });

  test("重复构造不会产生同名端口", () => {
    const once = buildFrameHandles({ first: true }, base);
    const twice = buildFrameHandles({ first: true }, once as typeof base);
    expect(twice.filter((item) => item.id === "firstFrame")).toHaveLength(1);
  });
});

describe("enabledFrameOutputs", () => {
  test("只认显式 true", () => {
    expect(enabledFrameOutputs(undefined)).toEqual([]);
    expect(enabledFrameOutputs({ first: true }).map((item) => item.key)).toEqual(["first"]);
    expect(enabledFrameOutputs({ first: false, last: true }).map((item) => item.key)).toEqual(["last"]);
  });
});

describe("frameOutputOptions", () => {
  test("首帧不 seek，取第一帧", () => {
    const { input, output } = frameOutputOptions("first");
    expect(input).toEqual([]);
    expect(output).toContain("-frames:v");
    expect(output[output.indexOf("-frames:v") + 1]).toBe("1");
  });

  test("尾帧用输入侧的 -sseof，且不限制帧数（逐帧覆盖到末尾）", () => {
    const { input, output } = frameOutputOptions("last");
    expect(input).toEqual(["-sseof", "-1"]);
    expect(output).not.toContain("-frames:v");
  });

  test("两种取向都固定首个视频流并复用文件名", () => {
    for (const key of ["first", "last"] as const) {
      const { output } = frameOutputOptions(key);
      expect(output[output.indexOf("-map") + 1]).toBe("0:v:0");
      expect(output[output.indexOf("-update") + 1]).toBe("1");
      expect(output).toContain("yuvj444p");
      expect(output.join(" ")).toContain("-q:v 2");
    }
  });

  test("不覆盖既有截帧的选项语义", () => {
    expect(JPEG_OUTPUT_OPTIONS).toContain("mjpeg");
    expect(JPEG_OUTPUT_OPTIONS).not.toContain("rgb24");
  });
});

describe("frameOutputMeta / staticNodeHandles", () => {
  test("handleId 与文件名固定，不能漂移", () => {
    expect(frameOutputMeta("first")).toMatchObject({ handleId: "firstFrame", fileName: "frame-first.jpg" });
    expect(frameOutputMeta("last")).toMatchObject({ handleId: "lastFrame", fileName: "frame-last.jpg" });
  });

  test("从组件类型上取声明期端口", () => {
    expect(staticNodeHandles({ handles: base })).toEqual(base);
    expect(staticNodeHandles({})).toEqual([]);
    expect(staticNodeHandles(undefined)).toEqual([]);
  });
});
