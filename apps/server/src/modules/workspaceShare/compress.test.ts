import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compressMedia, hasAlpha, isAnimated, mediaKind, planCompression, probeEncoders,
  type CompressionFacts, type MediaKind,
} from "./compress";

// 集成用例优先用本机随包 ffmpeg；其他机器回退 PATH，两者都没有时只跳过集成用例。
const bundledDirectory = "/Applications/toonflow-data/ffmpeg/darwin-arm64";
const ffmpeg = existsSync(join(bundledDirectory, "ffmpeg")) ? join(bundledDirectory, "ffmpeg") : Bun.which("ffmpeg") ?? "";
const ffprobe = existsSync(join(bundledDirectory, "ffprobe")) ? join(bundledDirectory, "ffprobe") : Bun.which("ffprobe") ?? "";
const ffmpegAvailable = Boolean(ffmpeg && ffprobe);

const workspace = mkdtempSync(join(tmpdir(), "toonflow-compress-"));
const file = (name: string) => join(workspace, name);

async function runFfmpeg(args: string[]) {
  const child = Bun.spawn([ffmpeg, "-hide_banner", "-v", "error", "-y", ...args], {
    stdin: "ignore", stdout: "ignore", stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, child.stderr.text()]);
  if (code !== 0) throw new Error(`ffmpeg ${args.join(" ")} 失败：${stderr}`);
}

async function probeJson(input: string, entries = "stream=width,height,codec_name,codec_type") {
  const child = Bun.spawn([ffprobe, "-v", "error", "-show_entries", entries, "-of", "json", "-i", input], {
    stdin: "ignore", stdout: "pipe", stderr: "ignore",
  });
  const [output, code] = await Promise.all([child.stdout.text(), child.exited]);
  if (code !== 0) throw new Error(`ffprobe 失败：${input}`);
  return JSON.parse(output) as { streams?: { width?: number; height?: number; codec_name?: string; codec_type?: string }[] };
}

const kinds: [string, MediaKind][] = [
  ["clip.mp4", "video"], ["CLIP.MOV", "video"], ["clip.m4v", "video"], ["clip.webm", "video"], ["clip.mkv", "video"],
  ["image.png", "image"], ["IMAGE.PNG", "image"], ["image.jpg", "image"], ["image.jpeg", "image"],
  ["image.webp", "image"], ["image.gif", "image"], ["image.svg", "image"], ["image.tif", "image"],
  ["image.tiff", "image"], ["image.apng", "image"],
  ["notes.md", "other"], ["data.json", "other"], ["voice.wav", "other"], ["voice.mp3", "other"], ["blob.xyz", "other"], ["noextension", "other"],
];

describe("mediaKind", () => {
  for (const [path, kind] of kinds) {
    test(`${path} → ${kind}`, () => {
      expect(mediaKind(path)).toBe(kind);
    });
  }
});

const facts = (kind: MediaKind, alpha = false, animated = false): CompressionFacts => ({ kind, alpha, animated });

describe("planCompression", () => {
  test("视频统一转 MP4，换扩展名与 mimeType", () => {
    for (const path of ["a.mp4", "a.mov", "a.m4v", "a.webm", "a.mkv", "A.WEBM"]) {
      expect(planCompression(path, facts("video"))).toEqual({ action: "transcode", outputExt: ".mp4", outputMime: "video/mp4" });
    }
  });

  test("静态无 alpha 图片转 JPEG", () => {
    for (const path of ["a.png", "a.jpg", "a.jpeg", "a.webp"]) {
      expect(planCompression(path, facts("image"))).toEqual({ action: "transcode", outputExt: ".jpg", outputMime: "image/jpeg" });
    }
  });

  test("含 alpha 图片只缩放不改格式", () => {
    expect(planCompression("a.png", facts("image", true))).toEqual({ action: "transcode", outputExt: ".png", outputMime: "image/png" });
    expect(planCompression("a.webp", facts("image", true))).toEqual({ action: "transcode", outputExt: ".webp", outputMime: "image/webp" });
  });

  test("GIF / SVG / TIFF 跳过并保留原扩展名与 mime", () => {
    const gif = planCompression("a.gif", facts("image", false, true));
    expect(gif.action).toBe("skip");
    expect(gif.outputExt).toBe(".gif");
    expect(gif.outputMime).toBe("image/gif");
    expect(gif.reason).toContain("GIF");

    const svg = planCompression("a.svg", facts("image", true));
    expect(svg).toMatchObject({ action: "skip", outputExt: ".svg", outputMime: "image/svg+xml" });
    expect(svg.reason).toContain("SVG");

    const tiff = planCompression("a.tiff", facts("image"));
    expect(tiff).toMatchObject({ action: "skip", outputExt: ".tiff", outputMime: "image/tiff" });
    expect(tiff.reason).toContain("TIFF");
  });

  test("动态 PNG / WebP 跳过", () => {
    for (const path of ["a.png", "a.webp"]) {
      const plan = planCompression(path, facts("image", false, true));
      expect(plan.action).toBe("skip");
      expect(plan.reason).toContain("动态");
    }
  });

  test("非媒体文件跳过", () => {
    const plan = planCompression("notes.md", facts("other"));
    expect(plan.action).toBe("skip");
    expect(plan.outputExt).toBe(".md");
    expect(plan.reason).toBeDefined();
  });

  test("skip 计划不启动 ffmpeg、不写文件", async () => {
    const output = file("skip-out.jpg");
    const wrote = await compressMedia({
      ffmpeg: "/definitely/not/ffmpeg", input: file("missing.png"), output,
      plan: planCompression("missing.gif", facts("image", false, true)),
    });
    expect(wrote).toBe(false);
    expect(existsSync(output)).toBe(false);
  });
});

describe("集成（真实 ffmpeg）", () => {
  beforeAll(async () => {
    if (!ffmpegAvailable) return;
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=641x361:rate=24", "-t", "1",
      "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv444p", file("odd-641x361.mp4")]);
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440", "-t", "1",
      "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv444p", "-c:a", "aac", file("with-audio.mp4")]);
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=red@0.0:s=64x64,format=rgba", "-frames:v", "1", "-update", "1", file("alpha.png")]);
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=gray:s=320x240,noise=alls=100:allf=t", "-frames:v", "1",
      "-pix_fmt", "rgb24", "-update", "1", file("noisy.png")]);
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=red:s=64x64,format=rgb24", "-frames:v", "1", "-update", "1", file("plain.png")]);
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=64x64:rate=10", "-t", "0.5", file("animated.gif")]);
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=64x64:rate=10", "-t", "0.5", "-plays", "0", "-f", "apng", file("animated.png")]);
    await runFfmpeg(["-i", file("animated.gif"), "-c:v", "libwebp_anim", "-loop", "0", file("animated.webp")]);
  });

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test.skipIf(!ffmpegAvailable)("probeEncoders 含 libx264", async () => {
    const encoders = await probeEncoders(ffmpeg);
    expect(encoders.has("libx264")).toBe(true);
    expect(encoders.has("aac")).toBe(true);
  });

  test.skipIf(!ffmpegAvailable)("hasAlpha：透明 PNG 为 true，不透明 PNG 为 false", async () => {
    expect(await hasAlpha(ffmpeg, file("alpha.png"))).toBe(true);
    expect(await hasAlpha(ffmpeg, file("noisy.png"))).toBe(false);
    expect(await hasAlpha(ffmpeg, file("plain.png"))).toBe(false);
  });

  test.skipIf(!ffmpegAvailable)("isAnimated：GIF / APNG / 动画 WebP 为 true，静态 PNG 为 false", async () => {
    expect(await isAnimated(ffprobe, file("animated.gif"))).toBe(true);
    expect(await isAnimated(ffprobe, file("animated.png"))).toBe(true);
    expect(await isAnimated(ffprobe, file("animated.webp"))).toBe(true);
    expect(await isAnimated(ffprobe, file("alpha.png"))).toBe(false);
    expect(await isAnimated(ffprobe, file("noisy.png"))).toBe(false);
  });

  test.skipIf(!ffmpegAvailable)("641x361 奇数宽视频压缩成功且变小", async () => {
    const input = file("odd-641x361.mp4");
    const output = file("odd-out.mp4");
    const plan = planCompression(input, { kind: "video", alpha: false, animated: false });
    expect(plan).toMatchObject({ action: "transcode", outputExt: ".mp4", outputMime: "video/mp4" });
    expect(await compressMedia({ ffmpeg, input, output, plan })).toBe(true);
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(0);
    expect(statSync(output).size).toBeLessThan(statSync(input).size);
    const stream = (await probeJson(output)).streams?.[0];
    expect(stream?.codec_name).toBe("h264");
    expect(stream?.width).toBe(640);
    expect(stream?.height).toBe(360);
    expect((stream?.width ?? 1) % 2).toBe(0);
  });

  test.skipIf(!ffmpegAvailable)("无音轨视频不生成音轨，有音轨视频保留音轨", async () => {
    const silentOutput = file("silent-out.mp4");
    const silentInput = file("odd-641x361.mp4");
    await compressMedia({
      ffmpeg, input: silentInput, output: silentOutput,
      plan: planCompression(silentInput, { kind: "video", alpha: false, animated: false }),
    });
    const silentStreams = (await probeJson(silentOutput)).streams ?? [];
    expect(silentStreams.some(stream => stream.codec_type === "audio")).toBe(false);

    const audioOutput = file("audio-out.mp4");
    const audioInput = file("with-audio.mp4");
    await compressMedia({
      ffmpeg, input: audioInput, output: audioOutput,
      plan: planCompression(audioInput, { kind: "video", alpha: false, animated: false }),
    });
    const audioStreams = (await probeJson(audioOutput)).streams ?? [];
    const audio = audioStreams.find(stream => stream.codec_type === "audio");
    expect(audio?.codec_name).toBe("aac");
  });

  test.skipIf(!ffmpegAvailable)("透明 PNG 只缩放、alpha 保留", async () => {
    const input = file("alpha.png");
    const output = file("alpha-out.png");
    const plan = planCompression(input, { kind: "image", alpha: true, animated: false });
    expect(plan).toMatchObject({ action: "transcode", outputExt: ".png", outputMime: "image/png" });
    expect(await compressMedia({ ffmpeg, input, output, plan })).toBe(true);
    expect(existsSync(output)).toBe(true);
    expect(await hasAlpha(ffmpeg, output)).toBe(true);
  });

  test.skipIf(!ffmpegAvailable)("不透明 PNG 转 JPEG 且无 alpha", async () => {
    const input = file("noisy.png");
    const output = file("noisy-out.jpg");
    const plan = planCompression(input, { kind: "image", alpha: false, animated: false });
    expect(plan).toMatchObject({ action: "transcode", outputExt: ".jpg", outputMime: "image/jpeg" });
    expect(await compressMedia({ ffmpeg, input, output, plan })).toBe(true);
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeLessThan(statSync(input).size);
    expect(await hasAlpha(ffmpeg, output)).toBe(false);
  });

  test.skipIf(!ffmpegAvailable)("压缩后反而变大时保留原文件并返回 false", async () => {
    const input = file("plain.png");
    const output = file("plain-out.jpg");
    const plan = planCompression(input, { kind: "image", alpha: false, animated: false });
    expect(await compressMedia({ ffmpeg, input, output, plan })).toBe(false);
    expect(existsSync(output)).toBe(false);
    expect(existsSync(input)).toBe(true);
  });
});
