/** 工程分享包容器层：64 字节明文头 + 可选分块 AES-256-GCM 负载。 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { deflateSync, Inflate } from "fflate";
import {
  SHARE_FLAG_ENCRYPTED,
  SHARE_HEADER_SIZE,
  SHARE_MAGIC,
  SHARE_MAX_ENTRIES,
  SHARE_MAX_ENTRY,
  SHARE_MAX_PAYLOAD,
  SHARE_VERSION,
  type ShareEntry,
  type ShareHeader,
  type ShareManifest,
  type ShareProgress,
  type ShareSourceEntry,
} from "./types";

const CHUNK_SIZE = 4 * 1024 * 1024;
// ACT: 导入按条目逐个 extract，但「manifest 有多长」「终止块是否完好」是整包属性。
// 不缓存的话 N 个条目要把首块与末块各解密 N 次（每条最多 4 MiB）。
const layoutCache = new Map<string, { size: number; mtimeMs: number; password: string; manifestLength: number }>();
const endVerified = new Map<string, true>();

function cacheKey(path: string, size: number, mtimeMs: number, password?: string) {
  return `${path}\u0000${size}\u0000${mtimeMs}\u0000${password ?? ""}`;
}

function remember<T>(map: Map<string, T>, key: string, value: T, limit = 8) {
  if (map.size >= limit) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
const TAG_SIZE = 16;
const MANIFEST_MAX = 16 * 1024 * 1024;
const END_AAD = Buffer.from("TFPROJ-END", "utf8");
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ShareErrorCode = "SHARE_FORMAT" | "SHARE_PASSWORD";

export class ShareContainerError extends Error {
  constructor(readonly code: ShareErrorCode, message: string) {
    super(message);
    this.name = "ShareContainerError";
  }
}

function fail(code: ShareErrorCode, message: string): never {
  throw new ShareContainerError(code, message);
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function u64(value: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function blockNonce(prefix: Buffer, index: number): Buffer {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0, 0, 4);
  nonce.writeBigUInt64BE(BigInt(index), 4);
  return nonce;
}

function encryptChunk(key: Buffer, prefix: Buffer, index: number, aad: Buffer, data: Uint8Array): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, blockNonce(prefix, index));
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

/** 密文块 = 明文 + tag；最后再加一个空明文的终止块 tag。 */
function decryptChunk(key: Buffer, prefix: Buffer, index: number, aad: Buffer, data: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, blockNonce(prefix, index));
  decipher.setAAD(aad);
  decipher.setAuthTag(data.subarray(data.length - TAG_SIZE));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_SIZE)), decipher.final()]);
}

function cipherPayloadSize(plainSize: number): number {
  return plainSize + Math.ceil(plainSize / CHUNK_SIZE) * TAG_SIZE + TAG_SIZE;
}

function plaintextPayloadSize(header: ShareHeader): number {
  if (!header.encrypted) return header.payloadSize;
  const dataSize = header.payloadSize - TAG_SIZE;
  if (dataSize < 0) fail("SHARE_FORMAT", "加密负载长度非法");
  const fullChunks = Math.floor(dataSize / (CHUNK_SIZE + TAG_SIZE));
  const rest = dataSize - fullChunks * (CHUNK_SIZE + TAG_SIZE);
  if (rest === 0) return fullChunks * CHUNK_SIZE;
  if (rest <= TAG_SIZE) fail("SHARE_FORMAT", "加密负载长度非法");
  return fullChunks * CHUNK_SIZE + rest - TAG_SIZE;
}

// scrypt 单次约 40ms，导入会按条目反复调用 extract；只缓存上一次的派生结果。
let keyCache: { salt: string; password: string; key: Buffer } | null = null;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  const saltHex = salt.toString("hex");
  if (keyCache && keyCache.salt === saltHex && keyCache.password === password) return Promise.resolve(keyCache.key);
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) return reject(error);
      keyCache = { salt: saltHex, password, key };
      resolve(key);
    });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("操作已取消");
  error.name = "AbortError";
  throw error;
}

async function readExactly(handle: FileHandle, length: number, position: number | null = null): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, position === null ? null : position + filled);
    if (bytesRead === 0) fail("SHARE_FORMAT", "分享包被截断");
    filled += bytesRead;
  }
  return buffer;
}

function buildHeader(encrypted: boolean, payloadSize: number, salt: Buffer, nonce: Buffer): Buffer {
  const header = Buffer.alloc(SHARE_HEADER_SIZE);
  SHARE_MAGIC.copy(header, 0);
  header.writeUInt16BE(SHARE_VERSION, 8);
  header.writeUInt16BE(encrypted ? SHARE_FLAG_ENCRYPTED : 0, 10);
  header.writeUInt32BE(encrypted ? CHUNK_SIZE : 0, 12);
  header.writeBigUInt64BE(BigInt(payloadSize), 16);
  salt.copy(header, 24);
  nonce.copy(header, 40);
  return header;
}

export async function readShareHeader(path: string): Promise<ShareHeader> {
  const info = await stat(path);
  if (!info.isFile() || info.size < SHARE_HEADER_SIZE) fail("SHARE_FORMAT", "不是有效的工程分享包：文件过短");
  const handle = await open(path, "r");
  let head: Buffer;
  try {
    head = await readExactly(handle, SHARE_HEADER_SIZE);
  } finally {
    await handle.close();
  }
  if (!head.subarray(0, 8).equals(SHARE_MAGIC)) fail("SHARE_FORMAT", "不是有效的工程分享包：魔数不符");
  const version = head.readUInt16BE(8);
  if (version !== SHARE_VERSION) fail("SHARE_FORMAT", `不支持的分享包版本：${version}`);
  const flags = head.readUInt16BE(10);
  if (flags & ~SHARE_FLAG_ENCRYPTED) fail("SHARE_FORMAT", "文件头标志位非法");
  const encrypted = (flags & SHARE_FLAG_ENCRYPTED) !== 0;
  const chunkSize = head.readUInt32BE(12);
  if (encrypted ? chunkSize !== CHUNK_SIZE : chunkSize !== 0) fail("SHARE_FORMAT", "文件头分块大小非法");
  const payloadSizeRaw = head.readBigUInt64BE(16);
  if (payloadSizeRaw > BigInt(SHARE_MAX_PAYLOAD)) fail("SHARE_FORMAT", "分享包负载超过大小上限");
  const payloadSize = Number(payloadSizeRaw);
  if (info.size !== SHARE_HEADER_SIZE + payloadSize) fail("SHARE_FORMAT", "文件长度与头部声明不一致（可能已截断或损坏）");
  for (let index = 52; index < SHARE_HEADER_SIZE; index++) {
    if (head[index] !== 0) fail("SHARE_FORMAT", "文件头保留字段非 0");
  }
  return {
    version,
    encrypted,
    chunkSize,
    payloadSize,
    salt: Buffer.from(head.subarray(24, 40)),
    nonce: Buffer.from(head.subarray(40, 52)),
  };
}

/** 按需产出负载明文字节；加密包从 start 所在的块开始解密，不从包首重放。 */
async function* readPayload(
  path: string,
  header: ShareHeader,
  password: string | undefined,
  start: number,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const total = plaintextPayloadSize(header);
  if (!isSize(start) || start > total) fail("SHARE_FORMAT", "条目偏移超出负载范围");
  const handle = await open(path, "r");
  try {
    if (!header.encrypted) {
      let position = SHARE_HEADER_SIZE + start;
      let remaining = total - start;
      while (remaining > 0) {
        throwIfAborted(signal);
        const length = Math.min(64 * 1024, remaining);
        yield await readExactly(handle, length, position);
        position += length;
        remaining -= length;
      }
      return;
    }
    if (!password) fail("SHARE_PASSWORD", "该分享包已加密，需要口令");
    const key = await deriveKey(password, header.salt);
    const firstChunk = Math.floor(start / CHUNK_SIZE);
    const intraOffset = start % CHUNK_SIZE;
    const chunkCount = Math.ceil(total / CHUNK_SIZE);
    for (let index = firstChunk; index < chunkCount; index++) {
      throwIfAborted(signal);
      const plainLength = Math.min(CHUNK_SIZE, total - index * CHUNK_SIZE);
      const data = await readExactly(handle, plainLength + TAG_SIZE, SHARE_HEADER_SIZE + index * (CHUNK_SIZE + TAG_SIZE));
      let plain: Buffer;
      try {
        plain = decryptChunk(key, header.nonce, index, u64(index), data);
      } catch {
        if (index === 0) fail("SHARE_PASSWORD", "口令错误");
        fail("SHARE_FORMAT", "分享包数据损坏");
      }
      yield index === firstChunk ? plain.subarray(intraOffset) : plain;
    }
  } finally {
    await handle.close();
  }
}

/** 终止块的 tag 覆盖空明文 + 固定 AAD，用来发现尾部被截掉。 */
async function verifyEndBlock(path: string, header: ShareHeader, password?: string): Promise<void> {
  if (!header.encrypted) return;
  if (!password) fail("SHARE_PASSWORD", "该分享包已加密，需要口令");
  const key = await deriveKey(password, header.salt);
  const handle = await open(path, "r");
  try {
    const tag = await readExactly(handle, TAG_SIZE, SHARE_HEADER_SIZE + header.payloadSize - TAG_SIZE);
    const index = Math.ceil(plaintextPayloadSize(header) / CHUNK_SIZE);
    try {
      decryptChunk(key, header.nonce, index, END_AAD, tag);
    } catch {
      fail("SHARE_FORMAT", "分享包不完整或已被篡改");
    }
  } finally {
    await handle.close();
  }
}

function parseManifestJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    fail("SHARE_FORMAT", "manifest 解析失败，分享包可能已损坏");
  }
}

function validateEntry(raw: unknown, index: number, dataSize: number): ShareEntry {
  if (typeof raw !== "object" || raw === null) fail("SHARE_FORMAT", `manifest.entries[${index}] 不是对象`);
  const entry = raw as Record<string, unknown>;
  if (typeof entry.path !== "string" || entry.path.length === 0) fail("SHARE_FORMAT", `manifest.entries[${index}].path 非法`);
  const { size, storedSize, offset } = entry;
  if (!isSize(size) || !isSize(storedSize) || !isSize(offset)) fail("SHARE_FORMAT", `manifest.entries[${index}] 的长度字段非法`);
  if (typeof entry.sha256 !== "string" || !SHA256_HEX.test(entry.sha256)) fail("SHARE_FORMAT", `manifest.entries[${index}].sha256 非法`);
  if (entry.codec !== "store" && entry.codec !== "deflate") fail("SHARE_FORMAT", `manifest.entries[${index}].codec 非法`);
  if (entry.codec === "store" && storedSize !== size) fail("SHARE_FORMAT", `manifest.entries[${index}] 的 store 条目长度不一致`);
  if (size > SHARE_MAX_ENTRY || storedSize > SHARE_MAX_ENTRY) fail("SHARE_FORMAT", `manifest.entries[${index}] 超过单条大小上限`);
  if (offset + storedSize > dataSize) fail("SHARE_FORMAT", `manifest.entries[${index}] 越界`);
  return { path: entry.path, size, storedSize, offset, sha256: entry.sha256, codec: entry.codec };
}

function validateManifest(raw: unknown, dataSize: number): ShareManifest {
  if (typeof raw !== "object" || raw === null) fail("SHARE_FORMAT", "manifest 不是对象");
  const manifest = raw as Record<string, unknown>;
  if (manifest.format !== "tfproj") fail("SHARE_FORMAT", "manifest.format 不是 tfproj");
  if (manifest.version !== SHARE_VERSION) fail("SHARE_FORMAT", "manifest.version 不受支持");
  if (!Array.isArray(manifest.entries)) fail("SHARE_FORMAT", "manifest.entries 缺失");
  if (manifest.entries.length > SHARE_MAX_ENTRIES) fail("SHARE_FORMAT", "条目数量超过上限");
  const entries = manifest.entries.map((entry, index) => validateEntry(entry, index, dataSize));
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (total > SHARE_MAX_PAYLOAD) fail("SHARE_FORMAT", "条目总大小超过上限");
  return manifest as unknown as ShareManifest;
}

export async function readShareManifest(path: string, password?: string): Promise<ShareManifest> {
  const header = await readShareHeader(path);
  const plainSize = plaintextPayloadSize(header);
  if (plainSize < 4) fail("SHARE_FORMAT", "分享包负载为空");
  const iterator = readPayload(path, header, password, 0)[Symbol.asyncIterator]();
  const parts: Buffer[] = [];
  let length = 0;
  const pullUntil = async (target: number) => {
    while (length < target) {
      const next = await iterator.next();
      if (next.done) fail("SHARE_FORMAT", "分享包被截断");
      parts.push(next.value);
      length += next.value.length;
    }
  };
  try {
    await pullUntil(4);
    const manifestLength = Buffer.concat(parts, length).readUInt32BE(0);
    if (manifestLength === 0 || manifestLength > MANIFEST_MAX) fail("SHARE_FORMAT", "manifest 长度非法");
    if (4 + manifestLength > plainSize) fail("SHARE_FORMAT", "manifest 长度超出负载范围");
    await pullUntil(4 + manifestLength);
    const merged = Buffer.concat(parts, length);
    const parsed = parseManifestJson(merged.subarray(4, 4 + manifestLength).toString("utf8"));
    return validateManifest(parsed, plainSize - 4 - manifestLength);
  } finally {
    await iterator.return?.(undefined);
  }
}

async function readManifestLength(
  path: string,
  header: ShareHeader,
  password: string | undefined,
  signal?: AbortSignal,
): Promise<number> {
  const plainSize = plaintextPayloadSize(header);
  const iterator = readPayload(path, header, password, 0, signal)[Symbol.asyncIterator]();
  try {
    const first = await iterator.next();
    if (first.done || first.value.length < 4) fail("SHARE_FORMAT", "分享包被截断");
    const manifestLength = first.value.readUInt32BE(0);
    if (manifestLength === 0 || manifestLength > MANIFEST_MAX) fail("SHARE_FORMAT", "manifest 长度非法");
    if (4 + manifestLength > plainSize) fail("SHARE_FORMAT", "manifest 长度超出负载范围");
    return manifestLength;
  } finally {
    await iterator.return?.(undefined);
  }
}

async function cachedManifestLength(path: string, header: ShareHeader, password: string | undefined, signal?: AbortSignal) {
  const info = await stat(path).catch(() => null);
  if (!info) return readManifestLength(path, header, password, signal);
  const key = cacheKey(path, info.size, info.mtimeMs, password);
  const cached = layoutCache.get(key);
  if (cached) return cached.manifestLength;
  const manifestLength = await readManifestLength(path, header, password, signal);
  remember(layoutCache, key, { size: info.size, mtimeMs: info.mtimeMs, password: password ?? "", manifestLength });
  return manifestLength;
}

/** 终止块只可能有两种结论：完好或损坏；同一个包同一个口令验一次就够。 */
async function verifiedEndBlock(path: string, header: ShareHeader, password?: string) {
  if (!header.encrypted) return;
  const info = await stat(path).catch(() => null);
  if (!info) return verifyEndBlock(path, header, password);
  const key = cacheKey(path, info.size, info.mtimeMs, password);
  if (endVerified.has(key)) return;
  await verifyEndBlock(path, header, password);
  remember(endVerified, key, true);
}

export async function extractShareEntry(
  path: string,
  header: ShareHeader,
  entry: ShareEntry,
  destination: string,
  password?: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!isSize(entry.size) || !isSize(entry.storedSize) || !isSize(entry.offset)) fail("SHARE_FORMAT", `条目 ${entry.path} 的长度字段非法`);
  const plainSize = plaintextPayloadSize(header);
  const manifestLength = await cachedManifestLength(path, header, password, signal);
  const dataSize = plainSize - 4 - manifestLength;
  if (entry.offset + entry.storedSize > dataSize) fail("SHARE_FORMAT", `条目 ${entry.path} 越界`);
  if (entry.codec === "store" && entry.storedSize !== entry.size) fail("SHARE_FORMAT", `条目 ${entry.path} 的 store 长度不一致`);
  const start = 4 + manifestLength + entry.offset;

  const partPath = `${destination}.part`;
  await unlink(partPath).catch(() => {});
  const handle = await open(partPath, "w");
  try {
    if (entry.codec === "store") {
      const hash = createHash("sha256");
      let written = 0;
      if (entry.storedSize > 0) {
        for await (const chunk of readPayload(path, header, password, start, signal)) {
          throwIfAborted(signal);
          const slice = chunk.length <= entry.storedSize - written ? chunk : chunk.subarray(0, entry.storedSize - written);
          hash.update(slice);
          await handle.write(slice);
          written += slice.length;
          if (written === entry.storedSize) break;
        }
      }
      if (written !== entry.storedSize) fail("SHARE_FORMAT", `条目 ${entry.path} 数据不完整`);
      if (hash.digest("hex") !== entry.sha256) fail("SHARE_FORMAT", `条目 ${entry.path} 校验失败：内容与 manifest 不一致`);
    } else {
      const hash = createHash("sha256");
      let written = 0;
      let output: Uint8Array[] = [];
      const inflate = new Inflate();
      inflate.ondata = (chunk) => output.push(chunk);
      const flush = async () => {
        if (output.length === 0) return;
        const total = output.reduce((sum, part) => sum + part.length, 0);
        if (written + total > entry.size) fail("SHARE_FORMAT", `条目 ${entry.path} 解压结果超过声明大小`);
        const merged = Buffer.concat(output, total);
        output = [];
        hash.update(merged);
        await handle.write(merged);
        written += merged.length;
      };
      let consumed = 0;
      if (entry.storedSize > 0) {
        for await (const chunk of readPayload(path, header, password, start, signal)) {
          throwIfAborted(signal);
          const input = chunk.length <= entry.storedSize - consumed ? chunk : chunk.subarray(0, entry.storedSize - consumed);
          consumed += input.length;
          const final = consumed === entry.storedSize;
          try {
            inflate.push(input, final);
          } catch {
            fail("SHARE_FORMAT", `条目 ${entry.path} 解压失败，分享包可能已损坏`);
          }
          await flush();
          if (final) break;
        }
      }
      if (consumed !== entry.storedSize) fail("SHARE_FORMAT", `条目 ${entry.path} 数据不完整`);
      if (written !== entry.size) fail("SHARE_FORMAT", `条目 ${entry.path} 解压结果长度不符`);
      if (hash.digest("hex") !== entry.sha256) fail("SHARE_FORMAT", `条目 ${entry.path} 校验失败：内容与 manifest 不一致`);
    }
    await verifiedEndBlock(path, header, password);
    await handle.close();
    await rename(partPath, destination);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(partPath).catch(() => {});
    throw error;
  }
}

interface PayloadSink {
  write(chunk: Uint8Array): Promise<void>;
  end(): Promise<void>;
}

function plainSink(handle: FileHandle): PayloadSink {
  return {
    async write(chunk) {
      await handle.write(chunk);
    },
    async end() {},
  };
}

function encryptedSink(handle: FileHandle, key: Buffer, noncePrefix: Buffer): PayloadSink {
  let parts: Buffer[] = [];
  let pending = 0;
  let index = 0;
  const drain = async () => {
    while (pending >= CHUNK_SIZE) {
      const merged = parts.length === 1 ? parts[0] : Buffer.concat(parts, pending);
      const rest = merged.subarray(CHUNK_SIZE);
      parts = rest.length > 0 ? [rest] : [];
      pending = rest.length;
      await handle.write(encryptChunk(key, noncePrefix, index, u64(index), merged.subarray(0, CHUNK_SIZE)));
      index += 1;
    }
  };
  return {
    async write(chunk) {
      parts.push(Buffer.from(chunk));
      pending += chunk.byteLength;
      await drain();
    },
    async end() {
      if (pending > 0) {
        const merged = Buffer.concat(parts, pending);
        parts = [];
        pending = 0;
        await handle.write(encryptChunk(key, noncePrefix, index, u64(index), merged));
        index += 1;
      }
      await handle.write(encryptChunk(key, noncePrefix, index, END_AAD, Buffer.alloc(0)));
    },
  };
}

async function streamSource(sink: PayloadSink, source: ShareSourceEntry, signal?: AbortSignal): Promise<void> {
  const stream = createReadStream(source.file!);
  let read = 0;
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      read += chunk.length;
      if (read > source.size) fail("SHARE_FORMAT", `条目 ${source.path} 的源文件已变化（读取超出声明大小）`);
      await sink.write(chunk);
    }
  } finally {
    stream.destroy();
  }
  if (read !== source.size) fail("SHARE_FORMAT", `条目 ${source.path} 的源文件已变化（大小不符）`);
}

export async function writeShareFile(
  target: string,
  options: {
    sources: ShareSourceEntry[];
    manifestBase: Omit<ShareManifest, "entries" | "stats">;
    password?: string;
    signal?: AbortSignal;
    onProgress?: (progress: ShareProgress) => void;
  },
): Promise<ShareManifest> {
  const { sources, manifestBase, password, signal, onProgress } = options;
  throwIfAborted(signal);
  if (manifestBase.format !== "tfproj" || manifestBase.version !== SHARE_VERSION) fail("SHARE_FORMAT", "manifestBase 的格式描述非法");
  if (sources.length > SHARE_MAX_ENTRIES) fail("SHARE_FORMAT", "条目数量超过上限");

  for (const source of sources) {
    if (typeof source.path !== "string" || source.path.length === 0) fail("SHARE_FORMAT", "条目 path 非法");
    if (!isSize(source.size) || !SHA256_HEX.test(source.sha256)) fail("SHARE_FORMAT", `条目 ${source.path} 的描述非法`);
    if (source.codec !== "store" && source.codec !== "deflate") fail("SHARE_FORMAT", `条目 ${source.path} 的 codec 非法`);
    if (source.bytes === undefined && !source.file) fail("SHARE_FORMAT", `条目 ${source.path} 缺少数据来源`);
    if (source.bytes !== undefined && source.bytes.byteLength !== source.size) fail("SHARE_FORMAT", `条目 ${source.path} 的大小与 manifest 不一致`);
  }

  // deflate 条目必须先整块压完，才能把 storedSize 写进 manifest。
  const compressed = new Map<number, Uint8Array>();
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    if (source.codec !== "deflate") continue;
    throwIfAborted(signal);
    const raw = source.bytes !== undefined ? source.bytes : await readFile(source.file!);
    if (raw.byteLength !== source.size) fail("SHARE_FORMAT", `条目 ${source.path} 的大小与 manifest 不一致`);
    compressed.set(index, deflateSync(raw));
  }

  // offset 相对条目数据区（manifest 之后）：若相对负载起点，offset 与 manifestLen 会互为输入。
  let offset = 0;
  let bytes = 0;
  const entries: ShareEntry[] = [];
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    const storedSize = source.codec === "deflate" ? compressed.get(index)!.byteLength : source.size;
    entries.push({ path: source.path, size: source.size, storedSize, offset, sha256: source.sha256, codec: source.codec });
    offset += storedSize;
    bytes += source.size;
  }

  const manifest: ShareManifest = {
    ...manifestBase,
    stats: { fileCount: sources.length, bytes, compressed: compressed.size },
    entries,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  if (manifestBytes.byteLength > MANIFEST_MAX) fail("SHARE_FORMAT", "manifest 过大");
  const plainPayloadSize = 4 + manifestBytes.byteLength + offset;
  if (plainPayloadSize > SHARE_MAX_PAYLOAD) fail("SHARE_FORMAT", "分享包超过大小上限");

  const encrypted = Boolean(password);
  const salt = encrypted ? randomBytes(16) : Buffer.alloc(16);
  const nonce = encrypted ? Buffer.concat([randomBytes(4), Buffer.alloc(8)]) : Buffer.alloc(12);
  const payloadSize = encrypted ? cipherPayloadSize(plainPayloadSize) : plainPayloadSize;
  if (payloadSize > SHARE_MAX_PAYLOAD) fail("SHARE_FORMAT", "分享包超过大小上限");
  const header = buildHeader(encrypted, payloadSize, salt, nonce);

  const partPath = `${target}.part`;
  await unlink(partPath).catch(() => {});
  const handle = await open(partPath, "w");
  try {
    await handle.write(header);
    const sink = encrypted ? encryptedSink(handle, await deriveKey(password!, salt), nonce) : plainSink(handle);
    await sink.write(u32(manifestBytes.byteLength));
    await sink.write(manifestBytes);
    let doneBytes = 0;
    for (let index = 0; index < sources.length; index++) {
      throwIfAborted(signal);
      const source = sources[index];
      const packed = compressed.get(index);
      if (packed !== undefined) await sink.write(packed);
      else if (source.bytes !== undefined) await sink.write(source.bytes);
      else await streamSource(sink, source, signal);
      doneBytes += source.size;
      onProgress?.({ done: index + 1, total: sources.length, bytes: doneBytes, currentFile: source.path });
    }
    await sink.end();
    await handle.close();
    await rename(partPath, target);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(partPath).catch(() => {});
    throw error;
  }
  return manifest;
}
