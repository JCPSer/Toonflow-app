import axios from "axios";
import { pickDesktop } from "./desktopDialog";

/** 工程分享（.tfproj）的接口封装：导出/导入都是异步任务，靠 status 轮询推进。 */

export const SHARE_UPLOAD_LIMIT = 2 * 1024 * 1024 * 1024;

export interface ShareManifest {
  format: "tfproj";
  version: number;
  createdAt: string;
  appVersion: string;
  project: { name: string };
  canvases: string[];
  stats: { fileCount: number; bytes: number; compressed: number };
}

export interface ShareImportResult {
  path: string;
  name: string;
  manifest?: ShareManifest;
}

export interface ShareTaskStatus {
  id: string;
  phase: "collecting" | "compressing" | "packing" | "importing" | "writing" | string;
  done: number;
  total: number;
  bytes: number;
  currentFile: string;
  missing: string[];
  skippedLarger: string[];
  finished: boolean;
  error?: string;
  cancelled?: boolean;
  result?: { manifest: ShareManifest; path: string };
}

interface Envelope<T> {
  code: number;
  data: T | null;
  message?: string;
}

const workspaceHeaders = { "x-toonflow-workspace": "1" };
const desktopHeaders = { "x-toonflow-desktop": "1" };

export const isShareFile = (file: { name: string }) => /\.tfproj$/i.test(file.name);

/** selectSaveFile 只接受单个文件名，不能带路径；这里把工程名收敛成合法文件名。 */
export function shareFileName(name: string) {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "");
  return `${(cleaned || "工程").slice(0, 233)}.tfproj`;
}

export function shareProjectName(name: string) {
  return name.trim().slice(0, 200) || "工程";
}

/** 桌面文件对话框：用户取消时 token / path 为 null。 */
export async function selectShareSaveTarget(fileName: string): Promise<string | null> {
  const { value } = await pickDesktop({ kind: "saveFile", fileName });
  return value;
}

export async function selectShareSourceFile(): Promise<string | null> {
  const { value } = await pickDesktop({ kind: "openFile", extension: "tfproj" });
  return value;
}

export async function startShareExport(input: { directory: string; name: string; saveToken: string; password?: string }) {
  const { data } = await axios.post<Envelope<{ id: string; phase: string }>>("/api/workspaces/share/export", input, { headers: workspaceHeaders });
  if (data.code !== 200 || !data.data?.id) throw new Error(data.message || "无法开始导出");
  return data.data;
}

// ACT: 导入固定落到工作区根目录，服务端只接受 filePath/password；不要传当前工程目录。
export async function startShareImport(input: { filePath: string; password?: string }) {
  const { data } = await axios.post<Envelope<{ id: string; phase: string }>>("/api/workspaces/share/import", input, { headers: workspaceHeaders });
  if (data.code !== 200 || !data.data?.id) throw new Error(data.message || "无法开始导入");
  return data.data;
}

/** 导出任务按工程目录归属，必须传 directory；导入任务固定在工作区根，不传。 */
export async function fetchShareStatus(id: string, directory?: string, signal?: AbortSignal): Promise<ShareTaskStatus> {
  const { data } = await axios.get<Envelope<ShareTaskStatus>>("/api/workspaces/share/status", {
    params: { id, ...(directory ? { directory } : {}) },
    headers: workspaceHeaders,
    signal,
  });
  if (data.code !== 200 || !data.data) throw new Error(data.message || "读取分享进度失败");
  return data.data;
}

/** 取消同样要跟发起时的归属一致：导出带工程目录，导入不带。 */
export async function cancelShareTask(id: string, directory?: string) {
  const { data } = await axios.post<Envelope<{ id: string }>>("/api/workspaces/share/cancel", { id, ...(directory ? { directory } : {}) }, { headers: workspaceHeaders });
  if (data.code !== 200) throw new Error(data.message || "取消分享任务失败");
}

/**
 * 拖入的文件拿不到绝对路径，只能先 PUT 原始字节换取临时路径。
 * ACT: 用 XHR 而不是 axios，只为了拿到 upload.onprogress。
 */
export function uploadShareFile(file: File, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const finish = (callback: () => void) => {
      signal?.removeEventListener("abort", abort);
      callback();
    };
    request.open("PUT", "/api/workspaces/share/upload");
    request.setRequestHeader("x-toonflow-workspace", "1");
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    request.onload = () => {
      finish(() => {
        let body: Envelope<{ path: string; size: number }> | undefined;
        try { body = JSON.parse(request.responseText) as Envelope<{ path: string; size: number }>; } catch { body = undefined; }
        if (request.status === 200 && body?.code === 200 && body.data?.path) {
          onProgress(file.size, file.size);
          resolve(body.data.path);
          return;
        }
        reject(new Error(body?.message || `上传分享文件失败（${request.status}）`));
      });
    };
    request.onerror = () => finish(() => reject(new Error("无法连接本机服务，请确认 Toonflow 正常运行后重试")));
    request.onabort = () => finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
    request.send(file);
  });
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function pollShareTask(
  id: string,
  directory: string | undefined,
  options: { signal?: AbortSignal; interval?: number; onUpdate?: (state: ShareTaskStatus) => void },
): Promise<ShareTaskStatus> {
  const { signal, interval = 800, onUpdate } = options;
  while (true) {
    const state = await fetchShareStatus(id, directory, signal);
    onUpdate?.(state);
    if (state.finished) return state;
    await wait(interval, signal);
  }
}

export function formatShareBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function shareErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as { message?: string } | undefined;
    return body?.message?.trim() || error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** 服务端把 FFMPEG_REQUIRED 放在 data.code；任务内失败只剩可读文案，两种都要识别。 */
export function isFfmpegRequired(error: unknown) {
  if (axios.isAxiosError(error)) {
    if (error.response?.status !== 409) return false;
    const body = error.response.data as { data?: { code?: string } | null } | undefined;
    return body?.data?.code === "FFMPEG_REQUIRED";
  }
  return false;
}

export function isFfmpegRequiredMessage(message: string) {
  return /ffmpeg/i.test(message) && /(安装|压缩|编码器)/.test(message);
}

export function isSharePasswordMessage(message: string) {
  return /口令|密码/.test(message);
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    || (error instanceof Error && error.name === "AbortError");
}
