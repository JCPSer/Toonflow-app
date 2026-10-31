import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractShareEntry, readShareHeader, readShareManifest, writeShareFile } from "./container";
import { SHARE_HEADER_SIZE, SHARE_MAGIC, SHARE_VERSION, type ShareManifest, type ShareSourceEntry } from "./types";

const CHUNK = 4 * 1024 * 1024;
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tfproj-container-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function pattern(size: number): Buffer {
  const buffer = Buffer.allocUnsafe(size);
  for (let index = 0; index < size; index++) buffer[index] = (index * 131 + (index >> 9)) & 0xff;
  return buffer;
}

function source(path: string, bytes: Uint8Array, codec: "store" | "deflate" = "store"): ShareSourceEntry {
  return { path, bytes, codec, size: bytes.byteLength, sha256: sha256(bytes) };
}

function baseManifest(name = "测试工程"): Omit<ShareManifest, "entries" | "stats"> {
  return {
    format: "tfproj",
    version: SHARE_VERSION,
    createdAt: "2026-10-31T00:00:00.000Z",
    appVersion: "test",
    project: { name },
    canvases: ["canvas.json"],
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("明文包", () => {
  test("头部、manifest 与条目可完整往返", async () => {
    const file = join(root, "plain.tfproj");
    const text = Buffer.from(JSON.stringify({ hello: "世界", items: [1, 2, 3] }).repeat(50));
    const media = pattern(200_000);
    const written = await writeShareFile(file, {
      sources: [source("canvas.json", text, "deflate"), source("assets/a.bin", media, "store")],
      manifestBase: baseManifest(),
    });

    const header = await readShareHeader(file);
    expect(header.encrypted).toBe(false);
    expect(header.chunkSize).toBe(0);
    expect(header.salt.equals(Buffer.alloc(16))).toBe(true);
    expect(header.nonce.equals(Buffer.alloc(12))).toBe(true);
    expect(header.payloadSize).toBe((await stat(file)).size - SHARE_HEADER_SIZE);

    const read = await readShareManifest(file);
    expect(read).toEqual(written);
    expect(read.stats).toEqual({ fileCount: 2, bytes: text.length + media.length, compressed: 1 });
    expect(read.entries[0].offset).toBe(0);
    expect(read.entries[0].storedSize).toBeLessThan(read.entries[0].size);
    expect(read.entries[1].offset).toBe(read.entries[0].storedSize);
    expect(read.entries[1].storedSize).toBe(media.length);

    const first = join(root, "out-canvas.json");
    const second = join(root, "out-a.bin");
    await extractShareEntry(file, header, read.entries[0], first);
    await extractShareEntry(file, header, read.entries[1], second);
    expect(Buffer.from(await readFile(first)).equals(text)).toBe(true);
    expect(Buffer.from(await readFile(second)).equals(media)).toBe(true);
    expect(await exists(`${file}.part`)).toBe(false);
  });
});

describe("加密包", () => {
  test("口令正确可读，缺失或错误口令报口令错误", async () => {
    const file = join(root, "secret.tfproj");
    const text = Buffer.from("正文内容".repeat(1000));
    const media = pattern(1_000_000);
    const written = await writeShareFile(file, {
      sources: [source("content.md", text, "deflate"), source("assets/v.mp4", media, "store")],
      manifestBase: baseManifest(),
      password: "correct horse",
    });

    const header = await readShareHeader(file);
    expect(header.encrypted).toBe(true);
    expect(header.chunkSize).toBe(CHUNK);
    expect(header.salt.equals(Buffer.alloc(16))).toBe(false);
    expect(header.nonce.length).toBe(12);

    await expect(readShareManifest(file)).rejects.toMatchObject({ code: "SHARE_PASSWORD" });
    await expect(readShareManifest(file, "wrong")).rejects.toMatchObject({ code: "SHARE_PASSWORD" });

    const read = await readShareManifest(file, "correct horse");
    expect(read).toEqual(written);

    const first = join(root, "out-secret.md");
    const second = join(root, "out-secret.mp4");
    await extractShareEntry(file, header, read.entries[0], first, "correct horse");
    await extractShareEntry(file, header, read.entries[1], second, "correct horse");
    expect(Buffer.from(await readFile(first)).equals(text)).toBe(true);
    expect(Buffer.from(await readFile(second)).equals(media)).toBe(true);

    const wrong = join(root, "wrong-out.bin");
    await expect(extractShareEntry(file, header, read.entries[1], wrong, "wrong")).rejects.toMatchObject({ code: "SHARE_PASSWORD" });
    expect(await exists(wrong)).toBe(false);
  });
});

describe("空文件", () => {
  test("store 与 deflate 的空条目都能往返", async () => {
    const file = join(root, "empty.tfproj");
    const empty = Buffer.alloc(0);
    const written = await writeShareFile(file, {
      sources: [source("empty.bin", empty, "store"), source("empty.txt", empty, "deflate")],
      manifestBase: baseManifest(),
      password: "pw",
    });

    const read = await readShareManifest(file, "pw");
    expect(read).toEqual(written);
    expect(read.stats.bytes).toBe(0);
    expect(read.entries[0].storedSize).toBe(0);

    const header = await readShareHeader(file);
    for (let index = 0; index < read.entries.length; index++) {
      const out = join(root, `empty-out-${index}.bin`);
      await extractShareEntry(file, header, read.entries[index], out, "pw");
      expect((await readFile(out)).byteLength).toBe(0);
    }
  });
});

describe("加密分块边界", () => {
  test("chunk-1 / chunk / chunk+1 字节的条目都能正确还原", async () => {
    const file = join(root, "boundary.tfproj");
    const sizes = [CHUNK - 1, CHUNK, CHUNK + 1];
    await writeShareFile(file, {
      sources: sizes.map((size, index) => source(`assets/b${index}.bin`, pattern(size))),
      manifestBase: baseManifest(),
      password: "pw",
    });

    const header = await readShareHeader(file);
    const read = await readShareManifest(file, "pw");
    for (let index = 0; index < sizes.length; index++) {
      const out = join(root, `boundary-${index}.bin`);
      await extractShareEntry(file, header, read.entries[index], out, "pw");
      const bytes = await readFile(out);
      expect(bytes.length).toBe(sizes[index]);
      expect(sha256(bytes)).toBe(read.entries[index].sha256);
    }
  }, 30_000);
});

describe("损坏与非法输入", () => {
  test("截断文件在读取头部时即报错", async () => {
    const file = join(root, "truncated.tfproj");
    await writeShareFile(file, { sources: [source("a.bin", pattern(4096))], manifestBase: baseManifest() });
    await truncate(file, (await stat(file)).size - 10);
    await expect(readShareHeader(file)).rejects.toThrow(/截断|不一致/);
  });

  test("篡改负载字节导致 sha256 不符，且不留目标文件", async () => {
    const file = join(root, "tampered.tfproj");
    const media = pattern(1024);
    await writeShareFile(file, { sources: [source("assets/a.bin", media)], manifestBase: baseManifest() });

    const header = await readShareHeader(file);
    const manifest = await readShareManifest(file);
    const bytes = await readFile(file);
    const manifestLength = bytes.readUInt32BE(SHARE_HEADER_SIZE);
    const position = SHARE_HEADER_SIZE + 4 + manifestLength + manifest.entries[0].offset + 100;
    bytes[position] ^= 0xff;
    await writeFile(file, bytes);

    const manifestAfter = await readShareManifest(file);
    const destination = join(root, "tampered-out.bin");
    await expect(extractShareEntry(file, header, manifestAfter.entries[0], destination)).rejects.toThrow(/校验失败/);
    expect(await exists(destination)).toBe(false);
    expect(await exists(`${destination}.part`)).toBe(false);
  });

  test("manifest 超过 16 MiB 被拒绝", async () => {
    const file = join(root, "huge-manifest.tfproj");
    const manifestLength = 16 * 1024 * 1024 + 1;
    const payload = Buffer.alloc(4 + manifestLength);
    payload.writeUInt32BE(manifestLength, 0);
    const header = Buffer.alloc(SHARE_HEADER_SIZE);
    SHARE_MAGIC.copy(header, 0);
    header.writeUInt16BE(SHARE_VERSION, 8);
    header.writeBigUInt64BE(BigInt(payload.length), 16);
    await writeFile(file, Buffer.concat([header, payload]));
    await expect(readShareManifest(file)).rejects.toThrow(/manifest 长度非法/);
  });

  test("头部保留字段非 0 被拒绝", async () => {
    const file = join(root, "reserved.tfproj");
    await writeShareFile(file, { sources: [source("a.bin", Buffer.from("x"))], manifestBase: baseManifest() });
    const bytes = await readFile(file);
    bytes[52] = 1;
    await writeFile(file, bytes);
    await expect(readShareHeader(file)).rejects.toThrow(/保留字段/);
  });
});

describe("取消", () => {
  test("中途取消后不留下目标文件与 .part", async () => {
    const file = join(root, "aborted.tfproj");
    const controller = new AbortController();
    await expect(
      writeShareFile(file, {
        sources: [source("a.bin", pattern(1024)), source("b.bin", pattern(1024))],
        manifestBase: baseManifest(),
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.done === 1) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(await exists(file)).toBe(false);
    expect(await exists(`${file}.part`)).toBe(false);
  });
});
