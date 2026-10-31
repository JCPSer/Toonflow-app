/** 工程分享包（.tfproj）的共享契约：容器层、收集层、编排层都只依赖这里。 */

export const SHARE_MAGIC = Buffer.from([0x54, 0x46, 0x50, 0x52, 0x4f, 0x4a, 0x00, 0x00]); // "TFPROJ\0\0"
export const SHARE_VERSION = 1;
export const SHARE_HEADER_SIZE = 64;
export const SHARE_FLAG_ENCRYPTED = 0x1;
export const SHARE_MAX_PAYLOAD = 2 * 1024 * 1024 * 1024;
export const SHARE_MAX_ENTRY = 1024 * 1024 * 1024;
export const SHARE_MAX_ENTRIES = 5000;

/** 单个条目在包内的描述；offset 相对于「manifest 之后的条目数据区」起点（首条为 0）。 */
export interface ShareEntry {
  path: string;
  /** 解码后字节数 */
  size: number;
  /** 实际占用的字节数；codec=store 时等于 size */
  storedSize: number;
  offset: number;
  sha256: string;
  codec: "store" | "deflate";
}

export interface ShareManifest {
  format: "tfproj";
  version: number;
  createdAt: string;
  appVersion: string;
  project: { name: string };
  canvases: string[];
  stats: { fileCount: number; bytes: number; compressed: number };
  entries: ShareEntry[];
}

export interface ShareHeader {
  version: number;
  encrypted: boolean;
  chunkSize: number;
  payloadSize: number;
  salt: Buffer;
  nonce: Buffer;
}

/** 导出侧的一个条目来源：媒体从磁盘流式读，文本可能已经在内存里。 */
export interface ShareSourceEntry {
  path: string;
  /** 绝对路径；与 bytes 二选一 */
  file?: string;
  bytes?: Uint8Array;
  codec: "store" | "deflate";
  sha256: string;
  size: number;
}

export interface ShareProgress {
  done: number;
  total: number;
  bytes: number;
  currentFile: string;
}
