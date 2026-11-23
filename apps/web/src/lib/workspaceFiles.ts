import axios from "axios";
import { isMobile, isRemoteConnection } from "./platform";
import { toValue, type MaybeRefOrGetter } from "vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { registerApiLanguage } from "@/lib/i18n";
import { bumpFileVersion, fileVersion, normalizeWorkspacePath } from "./fileVersions";
import { withBusyRetry, type BusyRetryOptions } from "./busyRetry";

type WorkspaceEntry = { name: string; path: string; type: "file" | "directory" };
export type TextSnapshot = { text: string; revision: string; encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" };
/** 单次写入可覆盖的 EBUSY 重试策略；其它调用点不传则沿用默认 4 次。 */
export type WriteRetry = Pick<BusyRetryOptions, "attempts" | "baseDelayMs">;
// ACT: 画布 JSON 常被 Agent 写入短暂加锁，默认 4×60ms 太短；统一 6 次 × 120ms 指数退避（最坏约 4 秒）。
export const CANVAS_WRITE_RETRY: WriteRetry = { attempts: 6, baseDelayMs: 120 };
const client = axios.create({ baseURL: "/api/workspaces/files", headers: { "x-toonflow-workspace": "1" } });
registerApiLanguage(client);
const fileUrls = new Map<string, { directory: string; path: string; url: Promise<string>; users: number }>();

function cachePath(path: string) {
  return normalizeWorkspacePath(path);
}

function invalidateUrls(directory: string, path: string) {
  // ACT: 仅失效时保守合并路径写法；实际读取仍交服务端校验，区分大小写的文件最多多读一次。
  directory = cachePath(directory);
  path = cachePath(path);
  // ACT: 缩略图缓存与 blob 缓存是两套——路径上即使没有在途 blob 缓存，缩略图 URL 也必须换一条：
  // 常驻的 `<img>` 只在 src 字符串变化时才重新请求，否则同路径覆写后界面会停在旧内容（首尾帧即如此）。
  // 服务端的 no-cache 只保证「请求了就会拿到最新的」，不会替我们发起请求。
  bumpFileVersion(directory, path);
  for (const [key, entry] of fileUrls) {
    const entryPath = cachePath(entry.path);
    if (cachePath(entry.directory) === directory && (entryPath === path || entryPath.startsWith(`${path}/`))) fileUrls.delete(key);
  }
}

export default function useWorkspaceFiles(directory?: MaybeRefOrGetter<string | undefined>) {
  const workspace = directory === undefined ? useWorkspaceStore() : undefined;
  function getDirectory() {
    const path = directory === undefined ? workspace?.project?.directory : toValue(directory);
    if (!path) throw new Error("请先选择工作目录");
    return path;
  }

  async function list(path = "", signal?: AbortSignal) {
    const { data } = await client.get<{ data: { directory: string; empty: boolean; entries: WorkspaceEntry[] } }>("/list", { params: { directory: getDirectory(), path }, signal });
    return data.data;
  }

  async function read(path: string) {
    const { data } = await client.get<ArrayBuffer>("/read", { params: { directory: getDirectory(), path }, responseType: "arraybuffer" });
    return data;
  }

  async function importImage(url: string) {
    const { data } = await client.post<{ data: { path: string; mimeType: string } }>("/importImage", { directory: getDirectory(), url });
    return data.data;
  }

  async function cloneProject(project: { url: string; name: string }, signal?: AbortSignal) {
    const { data } = await client.post<{ data: { directory: string } }>("/clone", { directory: getDirectory(), ...project }, { baseURL: "/api/workspaces", signal });
    return data.data;
  }

  function acquireUrl(path: string, mimeType?: string) {
    const directory = getDirectory();
    const key = JSON.stringify([directory, path, mimeType]);
    let entry = fileUrls.get(key);
    if (!entry) {
      const url = client.get<Blob>("/read", { params: { directory, path }, responseType: "blob" })
        .then(({ data }) => URL.createObjectURL(mimeType ? new Blob([data], { type: mimeType }) : data));
      entry = { directory, path, url, users: 0 };
      fileUrls.set(key, entry);
      const current = entry;
      void url.catch(() => { if (fileUrls.get(key) === current) fileUrls.delete(key); });
    }
    const current = entry;
    current.users++;
    let released = false;
    return {
      url: current.url,
      release() {
        if (released) return;
        released = true;
        if (--current.users) return;
        if (fileUrls.get(key) === current) fileUrls.delete(key);
        // 等待中的读取也要在最后一个使用者离开后释放，不撤销其他节点仍使用的 URL。
        void current.url.then(url => URL.revokeObjectURL(url), () => {});
      },
    };
  }

  async function readText(path: string, maxBytes?: number, signal?: AbortSignal) {
    if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error("读取字节数必须为正整数");
    try {
      const { data } = await client.get<string>("/read", {
        params: { directory: getDirectory(), path }, responseType: "text", transformResponse: [], signal,
        headers: maxBytes === undefined ? undefined : { Range: `bytes=0-${maxBytes - 1}` },
      });
      return data;
    } catch (error) {
      if (maxBytes !== undefined && axios.isAxiosError(error) && error.response?.status === 416 && error.response.headers["content-range"] === "bytes */0") return "";
      throw error;
    }
  }

  async function readJson<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    const text = await readText(path, undefined, signal);
    signal?.throwIfAborted();
    return JSON.parse(text);
  }

  async function readTextSnapshot(path: string, options?: { maxBytes?: number; signal?: AbortSignal }): Promise<TextSnapshot> {
    if (options?.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)) throw new Error("读取字节数必须为正整数");
    const { data } = await client.get<{ data: TextSnapshot }>("/read", {
      params: { directory: getDirectory(), path, snapshot: true, maxBytes: options?.maxBytes }, signal: options?.signal,
    });
    return data.data;
  }

  async function writeTextSnapshot(path: string, text: string, snapshot: Pick<TextSnapshot, "revision" | "encoding">) {
    const directory = getDirectory();
    // ACT: 同一路径正在被其他操作占用时服务端返回 409 EBUSY；这里统一退避重试。
    const { data } = await withBusyRetry(() => client.put<{ data: { revision: string } }>("/write", text, {
      params: { directory, path, expectedRevision: snapshot.revision, encoding: snapshot.encoding },
      headers: { "Content-Type": "application/octet-stream" },
    }));
    invalidateUrls(directory, path);
    return data.data.revision;
  }

  async function write(path: string, content: string | Blob | ArrayBuffer, exclusive = false, signal?: AbortSignal, retry?: WriteRetry) {
    const directory = getDirectory();
    await withBusyRetry(() => client.put("/write", content, { params: { directory, path, exclusive }, signal, headers: { "Content-Type": "application/octet-stream" } }), retry);
    invalidateUrls(directory, path);
  }

  function writeJson(path: string, data: unknown, exclusive = false, retry?: WriteRetry) {
    return write(path, `${JSON.stringify(data, null, 2)}\n`, exclusive, undefined, retry);
  }

  async function rename(path: string, target: string) {
    const directory = getDirectory();
    await withBusyRetry(() => client.post("/rename", { directory, path, target }));
    invalidateUrls(directory, path);
    invalidateUrls(directory, target);
  }

  async function copy(path: string, target: string, retry?: WriteRetry) {
    const directory = getDirectory();
    await withBusyRetry(() => client.post("/copy", { directory, path, target }), retry);
    invalidateUrls(directory, target);
  }

  async function reveal(path: string) {
    if (isRemoteConnection) throw new Error("远程项目文件无法在本机文件管理器中定位，请下载或导出后查看。");
    if (isMobile) throw new Error("移动端暂不支持在文件管理器中定位项目文件，请使用下载或导出保存文件。");
    await client.post("/reveal", { directory: getDirectory(), path });
  }

  async function remove(path: string, recursive = false) {
    const directory = getDirectory();
    await withBusyRetry(() => client.delete("/remove", { data: { directory, path, recursive } }));
    invalidateUrls(directory, path);
  }

  async function mkdir(path: string) {
    await withBusyRetry(() => client.post("/mkdir", { directory: getDirectory(), path }));
  }

  function thumbUrl(path: string, size = 512) {
    const directory = getDirectory();
    // ACT: v 是该文件在本次会话里的写版本（见 fileVersions）：同路径原地覆写后 URL 必须变化，
    // 否则下游引用卡等常驻 `<img>` 根本不会发请求，一直显示旧帧。服务端路由会忽略这个参数。
    const params = new URLSearchParams({ directory, path, size: String(size), v: String(fileVersion(directory, path)) });
    return `/api/workspaces/files/thumb?${params.toString()}`;
  }

  // ACT: 预热只填服务端缓存，失败静默；节点真正需要时仍是同一条 URL。
  // 返回 Promise 供画布串行等待；同一 URL 在途时复用，避免 <img>、watch、预热三路重复请求。
  const warmPending = new Map<string, Promise<void>>();
  function warmThumb(path: string, size = 512) {
    try {
      const url = thumbUrl(path, size);
      const pending = warmPending.get(url);
      if (pending) return pending;
      const task = fetch(url).then(() => {}, () => {}).finally(() => { warmPending.delete(url); });
      warmPending.set(url, task);
      return task;
    } catch {
      // 没有工作目录时 thumbUrl 会抛错，预热属于尽力而为，不向外冒泡。
      return Promise.resolve();
    }
  }

  // ACT: 当前目录逐次读取；跨 await 或防抖的操作传入目录字符串，固定本次目标。
  return { list, read, importImage, cloneProject, acquireUrl, thumbUrl, warmThumb, readText, readJson, readTextSnapshot, writeTextSnapshot, write, writeJson, rename, copy, reveal, remove, mkdir };
}

export type TransferResult = {
  files: { source: string; target: string; action: "copied" | "reused" }[];
  skipped: string[];
  missing: string[];
  failed: { path: string; message: string }[];
};

/**
 * 跨项目搬运文件：把 sourceDirectory 下的相对路径复制到 targetDirectory 的同名位置。
 * ACT: 与实例方法不同，这里两个目录都显式传入——跨项目粘贴时当前项目不是源项目。
 * 服务端保证同路径同内容复用、不同内容改名，绝不覆盖目标项目已有文件。
 */
export async function transferWorkspaceFiles(sourceDirectory: string, targetDirectory: string, paths: string[]) {
  const { data } = await client.post<{ data: TransferResult }>("/transfer", { sourceDirectory, targetDirectory, paths });
  return data.data;
}
