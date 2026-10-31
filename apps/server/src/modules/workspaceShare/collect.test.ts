import { describe, expect, test } from "bun:test";
import { markdownImagePaths, markdownImageSources, referencedPaths, resolveMarkdownPath, rewriteMediaPaths, sanitizeCanvas } from "./collect";

const node = (id: string, type: string, data: Record<string, unknown>) => ({ id, type, position: { x: 0, y: 0 }, data });
const canvas = (nodes: unknown[]) => ({ toonflowCanvas: true, nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

/** 图片节点：crop / scale 全套历史字段 + 输出。 */
const imageNode = node("image-1", "imageNode", {
  crop: {
    last: { url: "assets/image-1/crop-last.png", x: 1, y: 2, width: 3, height: 4 },
    previous: { url: "assets/image-1/crop-previous.png", mimeType: "image/png" },
    appliedUrl: "assets/image-1/crop-applied.png",
  },
  scale: {
    factor: 2,
    maxEdge: 2048,
    previous: { url: "assets/image-1/scale-previous.png", mimeType: "image/png" },
    appliedUrl: "assets/image-1/scale-applied.png",
  },
  outputs: { image: { dataType: "IMAGE", value: { url: "assets/image-1/output.png", mimeType: "image/png" } } },
});

/** 图片生成节点：局部重绘整套素材。 */
const inpaintNode = node("image-gen-1", "imageGenerationNode", {
  prompt: "重绘",
  inpaintPrompt: "换个天空",
  inpaint: {
    source: "assets/image-gen-1/source.png",
    original: "assets/image-gen-1/original.png",
    guide: "assets/image-gen-1/guide.png",
    mask: "assets/image-gen-1/mask.png",
    images: [{ path: "assets/image-gen-1/ref.png", mimeType: "image/png" }],
  },
  outputs: { image: { dataType: "IMAGE", value: { url: "assets/image-gen-1/out.png", mimeType: "image/png" } } },
});

/** 拉片节点：source / 分镜 / manifest 全在 data 里。 */
const frameAnalysisNode = node("frame-1", "frameAnalysisNode", {
  frameAnalysis: {
    source: { url: "assets/frame-1/source.mp4", mimeType: "video/mp4" },
    resultSource: { url: "assets/frame-1/result.mp4", mimeType: "video/mp4" },
    lastResult: {
      scenes: [
        { index: 1, image: "assets/frame-1/scene-1.png", video: "assets/frame-1/scene-1.mp4", audio: "assets/frame-1/scene-1.wav" },
      ],
      manifest: "assets/frame-1/analysis/manifest.json",
    },
  },
  frameAnalysisResult: { manifest: "assets/frame-1/result/manifest.json" },
  outputs: { video: { dataType: "VIDEO", value: { url: "assets/frame-1/out.mp4", mimeType: "video/mp4" } } },
});

describe("sanitizeCanvas", () => {
  test("图片节点：删 crop/scale 的历史回退字段，保留 crop.last 与 outputs", () => {
    const input = canvas([imageNode]);
    const result = sanitizeCanvas(input);
    const data = result.canvas.nodes[0].data;

    expect(result.dropped).toEqual([
      "nodes[0].data.crop.previous",
      "nodes[0].data.crop.appliedUrl",
      "nodes[0].data.scale.previous",
      "nodes[0].data.scale.appliedUrl",
    ]);
    expect(data.crop.last).toEqual({ url: "assets/image-1/crop-last.png", x: 1, y: 2, width: 3, height: 4 });
    expect(data.crop.previous).toBeUndefined();
    expect(data.crop.appliedUrl).toBeUndefined();
    expect(data.scale).toEqual({ factor: 2, maxEdge: 2048 });
    expect(data.outputs).toEqual(imageNode.data.outputs);
    expect(input).toEqual(canvas([imageNode]));
  });

  test("图片生成节点：inpaint 整个对象删除，不留半截素材", () => {
    const result = sanitizeCanvas(canvas([inpaintNode]));
    const data = result.canvas.nodes[0].data;

    expect(result.dropped).toEqual(["nodes[0].data.inpaint"]);
    expect("inpaint" in data).toBe(false);
    expect(data.prompt).toBe("重绘");
    expect(data.inpaintPrompt).toBe("换个天空");
    expect(data.outputs).toEqual(inpaintNode.data.outputs);
  });

  test("Agent 节点：会话指针删除，agentLastPrompt 保留", () => {
    const input = canvas([
      node("agent-1", "agentNode", {
        agentSessionFile: "assets/agent-1/session.json",
        agentSessionCloneFrom: "assets/agent-1/clone.json",
        agentLastPrompt: "继续",
      }),
    ]);
    const result = sanitizeCanvas(input);

    expect(result.dropped).toEqual([
      "nodes[0].data.agentSessionFile",
      "nodes[0].data.agentSessionCloneFrom",
    ]);
    expect(result.canvas.nodes[0].data).toEqual({ agentLastPrompt: "继续" });
  });

  test("拉片 / 文本 / 模型 / 视频 / 音频 / 便签 / 分组原样保留", () => {
    const input = canvas([
      frameAnalysisNode,
      { ...node("text-1", "textNode", { textPath: "assets/text-1/content.md", outputs: {} }), disabled: true },
      node("3d-1", "director3dNode", { modelPath: "assets/3d-1/model.glb", modelSnapshot: { id: "doc" } }),
      node("video-1", "videoNode", { outputs: { video: { dataType: "VIDEO", value: { url: "assets/video-1/clip.mp4", mimeType: "video/mp4" } } } }),
      node("audio-1", "audioNode", { outputs: { audio: { dataType: "AUDIO", value: { url: "assets/audio-1/sound.mp3", mimeType: "audio/mpeg" } } } }),
      node("note-1", "noteNode", { noteText: "便签", noteStyle: { color: "#ffffff" } }),
      node("group-1", "canvasGroup", {}),
    ]);
    const result = sanitizeCanvas(input);

    expect(result.dropped).toEqual([]);
    expect(result.canvas).toEqual(input);
    expect(result.canvas.nodes[0].data.frameAnalysis.lastResult.manifest).toBe("assets/frame-1/analysis/manifest.json");
    expect(result.canvas.nodes[1].data.textPath).toBe("assets/text-1/content.md");
    expect(result.canvas.nodes[1].disabled).toBe(true);
    expect(result.canvas.nodes[2].data.modelPath).toBe("assets/3d-1/model.glb");
    expect(result.canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  test("没有历史字段时不产生 dropped，且不改入参", () => {
    const input = canvas([node("note-1", "noteNode", { noteText: "只有便签" })]);
    const snapshot = JSON.stringify(input);
    const result = sanitizeCanvas(input);

    expect(result.dropped).toEqual([]);
    expect(result.canvas).toEqual(input);
    expect(result.canvas).not.toBe(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("非画布输入原样返回", () => {
    expect(sanitizeCanvas(null)).toEqual({ canvas: null, dropped: [] });
    expect(sanitizeCanvas({ nodes: "not-an-array" })).toEqual({ canvas: { nodes: "not-an-array" }, dropped: [] });
  });

  test("清理后引用收集不再包含历史图片", () => {
    const { canvas: clean } = sanitizeCanvas(canvas([imageNode]));
    expect(referencedPaths(clean)).toEqual(["assets/image-1/crop-last.png", "assets/image-1/output.png"]);
  });
});

describe("referencedPaths", () => {
  test("递归兜底命中字段差集：inpaint.images、lastResult.manifest、crop 差集", () => {
    const input = {
      toonflowCanvas: true,
      nodes: [
        inpaintNode,
        frameAnalysisNode,
        node("text-1", "textNode", { textPath: "./assets/text-1/content.md" }),
      ],
    };
    expect(referencedPaths(input)).toEqual([
      "assets/image-gen-1/source.png",
      "assets/image-gen-1/original.png",
      "assets/image-gen-1/guide.png",
      "assets/image-gen-1/mask.png",
      "assets/image-gen-1/ref.png",
      "assets/image-gen-1/out.png",
      "assets/frame-1/source.mp4",
      "assets/frame-1/result.mp4",
      "assets/frame-1/scene-1.png",
      "assets/frame-1/scene-1.mp4",
      "assets/frame-1/scene-1.wav",
      "assets/frame-1/analysis/manifest.json",
      "assets/frame-1/result/manifest.json",
      "assets/frame-1/out.mp4",
      "assets/text-1/content.md",
    ]);
  });

  test("单段路径、./ 前缀、反斜杠、library 前缀都命中并规范化", () => {
    const input = {
      values: [
        "assets/foo.png",
        "./assets/x.png",
        "library/.library/index.json",
        "library-assets/foo.png",
        "assets\\win\\y.png",
        "https://example.com/assets/z.png",
        "/assets/abs.png",
        "assets",
        "myassets/a.png",
        "assets/foo.png",
      ],
    };
    expect(referencedPaths(input)).toEqual([
      "assets/foo.png",
      "assets/x.png",
      "library/.library/index.json",
      "library-assets/foo.png",
      "assets/win/y.png",
    ]);
  });

  test("非字符串值与空画布不产生路径", () => {
    expect(referencedPaths({ a: 1, b: true, c: null, d: ["assets/a.png"] })).toEqual(["assets/a.png"]);
    expect(referencedPaths(null)).toEqual([]);
  });
});

describe("markdownImagePaths", () => {
  const content = [
    "# 正文",
    "![插图 A](assets/text-1/a.png)",
    '![带标题](./assets/text-1/b.png "标题")',
    "![尖括号](<assets/text-1/带 空格.png>)",
    "![外链](https://example.com/c.png)",
    "![数据](data:image/png;base64,AAAA)",
    "![绝对](/root/d.png)",
    '<img alt="E" src="assets/text-1/e.png">',
    "<img src='/assets/text-1/f.png'>",
    "<img src=assets/text-1/g.png>",
    '<img data-src="assets/text-1/fake.png" src="assets/text-1/h.png">',
    '<img src="//cdn.example.com/i.png">',
    "![重复](assets/text-1/a.png)",
  ].join("\n");

  test("解析 markdown 与 HTML 插图，跳过外链 / data / 绝对路径", () => {
    expect(markdownImagePaths(content)).toEqual([
      "assets/text-1/a.png",
      "assets/text-1/b.png",
      "assets/text-1/带 空格.png",
      "assets/text-1/e.png",
      "assets/text-1/g.png",
      "assets/text-1/h.png",
    ]);
  });

  test("空正文返回空数组", () => {
    expect(markdownImagePaths("")).toEqual([]);
    expect(markdownImagePaths("没有图片的正文")).toEqual([]);
  });

  test("markdownImageSources 只抓原始引用串，不规范化、不过滤 scheme", () => {
    expect(markdownImageSources(content)).toEqual([
      "assets/text-1/a.png",
      "./assets/text-1/b.png",
      "assets/text-1/带 空格.png",
      "https://example.com/c.png",
      "data:image/png;base64,AAAA",
      "/root/d.png",
      "assets/text-1/e.png",
      "/assets/text-1/f.png",
      "assets/text-1/g.png",
      "assets/text-1/h.png",
      "//cdn.example.com/i.png",
    ]);
  });
});

describe("resolveMarkdownPath", () => {
  test("插图按正文所在目录解析：pic.png / ../other/x.png", () => {
    const sources = markdownImageSources("![](pic.png)\n![](../other/x.png)");
    expect(sources).toEqual(["pic.png", "../other/x.png"]);
    expect(sources.map((source) => resolveMarkdownPath(source, "assets/node-1/content.md"))).toEqual([
      "assets/node-1/pic.png",
      "assets/other/x.png",
    ]);
  });

  test("支持 URL 编码与 ?/# 截断", () => {
    expect(resolveMarkdownPath("插图.png", "assets/text-1/content.md")).toBe("assets/text-1/插图.png");
    expect(resolveMarkdownPath("sub/%E5%9B%BE.png", "assets/text-1/content.md")).toBe("assets/text-1/sub/图.png");
    expect(resolveMarkdownPath("./a.png?x=1#hash", "assets/text-1/content.md")).toBe("assets/text-1/a.png");
  });

  test("外链、绝对路径、越界 .. 一律返回 null", () => {
    expect(resolveMarkdownPath("/etc/passwd", "assets/node-1/content.md")).toBeNull();
    expect(resolveMarkdownPath("https://example.com/a.png", "assets/text-1/content.md")).toBeNull();
    expect(resolveMarkdownPath("mailto:a@b.c", "assets/text-1/content.md")).toBeNull();
    expect(resolveMarkdownPath("#anchor", "assets/text-1/content.md")).toBeNull();
    expect(resolveMarkdownPath("/root/a.png", "assets/text-1/content.md")).toBeNull();
    expect(resolveMarkdownPath("../escape.png", "content.md")).toBeNull();
    expect(resolveMarkdownPath("bad%zz.png", "assets/text-1/content.md")).toBeNull();
  });
});

describe("rewriteMediaPaths", () => {
  test("webm→mp4 同步改写 outputs 的 url 与 mimeType", () => {
    const input = canvas([
      node("video-1", "videoGenerationNode", {
        crop: { last: { url: "assets/video-1/clip.webm", mimeType: "video/webm" } },
        outputs: { video: { dataType: "VIDEO", value: { url: "assets/video-1/clip.webm", mimeType: "video/webm" } } },
      }),
    ]);
    const result = rewriteMediaPaths(input, new Map([["assets/video-1/clip.webm", { path: "assets/video-1/clip.mp4", mimeType: "video/mp4" }]]));
    const data = result.canvas.nodes[0].data;

    expect(data.outputs.video.value).toEqual({ url: "assets/video-1/clip.mp4", mimeType: "video/mp4" });
    expect(data.crop.last.url).toBe("assets/video-1/clip.mp4");
    // 方案只要求改写 outputs 的 mimeType；crop 的 mimeType 不参与包装。
    expect(data.crop.last.mimeType).toBe("video/webm");
    expect(result.changed).toEqual(["assets/video-1/clip.webm"]);
    expect((input.nodes[0] as { data: { outputs: { video: { value: { url: string } } } } }).data.outputs.video.value.url).toBe("assets/video-1/clip.webm");
  });

  test("只替换完全相等的字符串，不误伤子串", () => {
    const input = {
      values: ["a/b.png", "xa/b.png", "prefix-a/b.png", "a/b.png2"],
      outputs: { image: { dataType: "IMAGE", value: { url: "a/b.png", mimeType: "image/png" } } },
    };
    const result = rewriteMediaPaths(input, new Map([["a/b.png", { path: "a/b.jpg", mimeType: "image/jpeg" }]]));

    expect(result.canvas.values).toEqual(["a/b.jpg", "xa/b.png", "prefix-a/b.png", "a/b.png2"]);
    expect(result.canvas.outputs.image.value.mimeType).toBe("image/jpeg");
    expect(result.changed).toEqual(["a/b.png"]);
    expect(input.values[0]).toBe("a/b.png");
  });

  test("同一旧路径出现多次只记一次 changed", () => {
    const input = {
      outputs: { a: { value: { url: "assets/x.webm", mimeType: "video/webm" } }, b: { value: { url: "assets/x.webm" } } },
      extra: ["assets/x.webm"],
    };
    const result = rewriteMediaPaths(input, new Map([["assets/x.webm", { path: "assets/x.mp4", mimeType: "video/mp4" }]]));

    expect(result.changed).toEqual(["assets/x.webm"]);
    expect(result.canvas.extra).toEqual(["assets/x.mp4"]);
    expect(result.canvas.outputs.a.value.mimeType).toBe("video/mp4");
  });

  test("路径不变只改 mimeType 时也算改动", () => {
    const input = { outputs: { video: { value: { url: "assets/x.mp4", mimeType: "application/octet-stream" } } } };
    const result = rewriteMediaPaths(input, new Map([["assets/x.mp4", { path: "assets/x.mp4", mimeType: "video/mp4" }]]));

    expect(result.canvas.outputs.video.value).toEqual({ url: "assets/x.mp4", mimeType: "video/mp4" });
    expect(result.changed).toEqual(["assets/x.mp4"]);
  });

  test("没有命中的映射返回空 changed", () => {
    const input = canvas([node("video-1", "videoNode", { outputs: { video: { value: { url: "assets/video-1/clip.mp4", mimeType: "video/mp4" } } } })]);
    const result = rewriteMediaPaths(input, new Map([["assets/other.webm", { path: "assets/other.mp4", mimeType: "video/mp4" }]]));

    expect(result.changed).toEqual([]);
    expect(result.canvas).toEqual(input);
  });

  test("空映射不与画布交互", () => {
    const input = canvas([imageNode]);
    const result = rewriteMediaPaths(input, new Map());

    expect(result.changed).toEqual([]);
    expect(result.canvas).toEqual(input);
    expect(result.canvas).not.toBe(input);
  });
});
