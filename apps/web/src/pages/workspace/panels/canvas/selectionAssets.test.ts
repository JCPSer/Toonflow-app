import { describe, expect, test } from "bun:test";
import type { GraphNode } from "@vue-flow/core";
import { assetFileExtension, getAssetSource, prepareSelectionAssets } from "./selectionAssets";

function imageOutput(url: string) {
  return { dataType: "IMAGE", value: { url, mimeType: "image/png" } };
}

function videoOutput(url: string) {
  return { dataType: "VIDEO", value: { url, mimeType: "video/mp4" } };
}

function node(id: string, data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { id, type: "imageGenerationNode", label: id, data, ...overrides } as unknown as GraphNode;
}

function flowOf(nodes: GraphNode[]) {
  return { getNodes: { value: nodes } } as unknown as Parameters<typeof prepareSelectionAssets>[0];
}

describe("getAssetSource", () => {
  test("同时有多个 source 时优先 image/video handle", () => {
    const target = node("a", {
      handles: [
        { id: "mask", type: "source", dataType: "IMAGE" },
        { id: "video", type: "source", dataType: "VIDEO" },
      ],
      outputs: { mask: imageOutput("assets/mask.png"), video: videoOutput("assets/clip.mp4") },
    });
    expect(getAssetSource(target)?.dataType).toBe("VIDEO");
  });

  test("handles 缺失时先找 image/video，再按 outputs 键顺序回退", () => {
    const withPreferred = node("a", { outputs: { cover: imageOutput("assets/c.png"), video: videoOutput("assets/v.mp4") } });
    expect(getAssetSource(withPreferred)?.value.url).toBe("assets/v.mp4");
    const unpreferred = node("b", { outputs: { thumb: imageOutput("assets/t.png"), cover: imageOutput("assets/c.png") } });
    expect(getAssetSource(unpreferred)?.value.url).toBe("assets/t.png");
  });

  test("没有图片/视频产物时返回 undefined", () => {
    const target = node("a", { outputs: { text: { dataType: "STRING", value: "hi" } } });
    expect(getAssetSource(target)).toBeUndefined();
  });
});

describe("assetFileExtension", () => {
  test("URL 扩展名优先于 mime", () => {
    expect(assetFileExtension("assets/a.webp", "image/png")).toBe("webp");
  });

  test("URL 没有扩展名时按 mime 推断", () => {
    expect(assetFileExtension("assets/a", "video/quicktime")).toBe("mov");
  });

  test("无法判断时返回空串", () => {
    expect(assetFileExtension("assets/a", "application/octet-stream")).toBe("");
  });
});

describe("prepareSelectionAssets", () => {
  test("按「节点名 序号.扩展名」生成写入文件名", () => {
    const nodes = [
      node("a", { label: "主图", outputs: { image: imageOutput("assets/a.png") } }),
      node("b", { label: "视频", outputs: { video: videoOutput("assets/b") } }),
    ];
    expect(prepareSelectionAssets(flowOf(nodes), nodes).map(item => item.name)).toEqual(["主图 1.png", "视频 2.mp4"]);
  });

  test("禁用节点不进入预览，序号连续", () => {
    const nodes = [
      node("a", { label: "A", outputs: { image: imageOutput("assets/a.png") } }),
      node("b", { label: "B", disabled: true, outputs: { image: imageOutput("assets/b.png") } }),
      node("c", { label: "C", outputs: { image: imageOutput("assets/c.png") } }),
    ];
    expect(prepareSelectionAssets(flowOf(nodes), nodes).map(item => item.name)).toEqual(["A 1.png", "C 2.png"]);
  });

  test("选中分组时展开到叶子节点并按叶子顺序编号", () => {
    const group = node("g", {}, { type: "canvasGroup" });
    const childA = node("a", { label: "A", outputs: { image: imageOutput("assets/a.png") } }, { parentNode: "g" });
    const childB = node("b", { label: "B", outputs: { image: imageOutput("assets/b.png") } }, { parentNode: "g" });
    const nodes = [group, childA, childB];
    expect(prepareSelectionAssets(flowOf(nodes), [group]).map(item => item.name)).toEqual(["A 1.png", "B 2.png"]);
  });

  test("非法字符被清理，空标题回退节点 id", () => {
    const nodes = [
      node("a", { label: "主图/草稿", outputs: { image: imageOutput("assets/a.png") } }),
      node("b", { label: "  ", outputs: { image: imageOutput("assets/b.png") } }),
    ];
    expect(prepareSelectionAssets(flowOf(nodes), nodes).map(item => item.name)).toEqual(["主图草稿 1.png", "b 2.png"]);
  });

  test("超长标题截断后仍保留序号与扩展名", () => {
    const nodes = [node("a", { label: "长".repeat(300), outputs: { image: imageOutput("assets/a.png") } })];
    const [item] = prepareSelectionAssets(flowOf(nodes), nodes);
    expect(item?.name.endsWith(" 1.png")).toBe(true);
    expect([...(item?.name ?? "")].length).toBeLessThanOrEqual(200);
  });

  test("没有产物时标记 source 缺失，预览名退回节点名", () => {
    const nodes = [node("a", { label: "空节点" })];
    const [item] = prepareSelectionAssets(flowOf(nodes), nodes);
    expect(item?.source).toBeUndefined();
    expect(item?.name).toBe("空节点");
  });
});
