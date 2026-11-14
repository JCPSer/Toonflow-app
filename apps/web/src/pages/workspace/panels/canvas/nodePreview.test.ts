import { describe, expect, test } from "bun:test";
import { pickNodePreview } from "./nodePreview";

const image = (url: string) => ({ dataType: "IMAGE" as const, value: { url, mimeType: "image/png" } });
const mask = (url: string) => ({ dataType: "MASK" as const, value: { url, mimeType: "image/png" } });
const video = (url: string) => ({ dataType: "VIDEO" as const, value: { url, mimeType: "video/mp4" } });
const audio = (url: string) => ({ dataType: "AUDIO" as const, value: { url, mimeType: "audio/mpeg" } });

describe("pickNodePreview", () => {
  test("图片节点取 IMAGE 输出，带上 mimeType 供解析", () => {
    expect(pickNodePreview({ data: { label: "图片1", outputs: { image: image("a.png") } } }))
      .toEqual({ kind: "image", url: "a.png", mimeType: "image/png", title: "图片1" });
  });

  test("掩码输出按图片预览", () => {
    expect(pickNodePreview({ data: { outputs: { mask: mask("m.png") } } }))
      .toEqual({ kind: "image", url: "m.png", mimeType: "image/png", title: "节点预览" });
  });

  test("视频节点同时有首尾帧时优先视频", () => {
    const node = { data: { label: "视频1", outputs: { video: video("v.mp4"), first: image("f.png"), last: image("l.png") } } };
    expect(pickNodePreview(node)?.kind).toBe("video");
    expect(pickNodePreview(node)?.url).toBe("v.mp4");
  });

  test("没有视频时音频优先于图片", () => {
    const node = { data: { outputs: { audio: audio("a.mp3"), cover: image("c.png") } } };
    expect(pickNodePreview(node)?.kind).toBe("audio");
  });

  test("首个视频 url 为空时回落到音频/图片", () => {
    const node = { data: { outputs: { video: { dataType: "VIDEO" as const, value: { url: "", mimeType: "video/mp4" } }, audio: audio("a.mp3") } } };
    expect(pickNodePreview(node)?.kind).toBe("audio");
    expect(pickNodePreview({ data: { outputs: { video: { dataType: "VIDEO" as const, value: { url: "", mimeType: "video/mp4" } }, image: image("c.png") } } })?.kind).toBe("image");
  });

  test("同类多个时优先端口优先，其次按 handles 顺序", () => {
    const node = {
      data: {
        handles: [
          { id: "first", type: "source" as const, dataType: "IMAGE" as const },
          { id: "image", type: "source" as const, dataType: "IMAGE" as const },
        ],
        outputs: { first: image("first.png"), image: image("image.png") },
      },
    };
    expect(pickNodePreview(node)?.url).toBe("image.png");
  });

  test("没有 handles 时退化为 outputs 键序", () => {
    const node = { data: { outputs: { a: image("a.png"), b: image("b.png") } } };
    expect(pickNodePreview(node)?.url).toBe("a.png");
  });

  test("空输出、无 outputs、空 url、value 为空都返回 undefined", () => {
    expect(pickNodePreview({ data: {} })).toBeUndefined();
    expect(pickNodePreview({ data: { outputs: {} } })).toBeUndefined();
    expect(pickNodePreview({ data: { outputs: { image: { dataType: "IMAGE", value: { url: "", mimeType: "image/png" } } } } })).toBeUndefined();
    expect(pickNodePreview({ data: { outputs: { image: { dataType: "IMAGE", value: { url: "a.png", mimeType: "" } } } } })).toBeUndefined();
    expect(pickNodePreview(undefined)).toBeUndefined();
  });

  test("文本/数字/FILE 输出不参与预览", () => {
    const node = {
      data: {
        outputs: {
          text: { dataType: "STRING" as const, value: "hi" },
          count: { dataType: "INT" as const, value: 3 },
          file: { dataType: "FILE" as const, value: { url: "a.zip", mimeType: "application/zip" } },
        },
      },
    };
    expect(pickNodePreview(node)).toBeUndefined();
  });

  test("标题取节点名，空名回退默认", () => {
    expect(pickNodePreview({ data: { label: "  ", outputs: { image: image("a.png") } } })?.title).toBe("节点预览");
  });
});
