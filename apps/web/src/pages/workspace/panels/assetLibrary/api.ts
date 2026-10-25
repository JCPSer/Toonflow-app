import axios, { type AxiosResponse } from "axios";
import { registerApiLanguage } from "@/lib/i18n";
import type { AssetRoots, AssetSelector } from "./types";
import type { AssetBatchResult, AssetEntry, AssetErrorInfo, AssetListOptions, AssetListResult, AssetLibraryKind, AssetTrashResult, AssetTreeResult, AssetUsage, AssetUsageCheck, AssetUsageCheckState } from "./types";
import { mockAssetUrl, mockList, mockMeta, mockMkdir, mockMode, mockMove, mockPurge, mockRemove, mockRestore, mockRoots, mockRename, mockSave, mockThumbnail, mockTrash, mockTree } from "./mock";

const client = axios.create({ baseURL: "/api/assets", headers: { "x-toonflow-workspace": "1" } });
registerApiLanguage(client);

type Envelope<T> = { code: number; data: T | null; message?: string };

const probeIntervalMs = 3000;
// ACT: 演示数据只在开发构建里、且显式开启时兜底；否则失败的请求必须暴露真实错误，
// 避免把"上传失败"伪装成成功，也避免用演示素材做出错误的功能判断。
const mockFlagKey = "toonflow.assetLibrary.mock";
function readMockFlag() {
  if (!import.meta.env.DEV) return false;
  if (new URLSearchParams(location.search).get("assetMock") === "1") return true;
  try {
    return localStorage.getItem(mockFlagKey) === "1";
  } catch {
    return false;
  }
}
const mockEnabled = readMockFlag();
let live: boolean | undefined;
let lastProbe = 0;

export class AssetRequestError extends Error {
  status?: number;
  code?: string;
  usages: AssetUsage[];
  checked?: AssetUsageCheckState;
  constructor(message: string, status?: number, code?: string, usages: AssetUsage[] = [], checked?: AssetUsageCheckState) {
    super(message);
    this.name = "AssetRequestError";
    this.status = status;
    this.code = code;
    this.usages = usages;
    this.checked = checked;
  }
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return !!value && typeof value === "object" && typeof (value as { code?: unknown }).code === "number";
}

function isGenuineApiError(error: unknown) {
  return axios.isAxiosError(error) && isEnvelope(error.response?.data);
}

function isMissingEndpoint(error: unknown) {
  if (error instanceof AssetRequestError) return error.status === 0 || error.status === 404 || error.status === 405 || error.status === 501;
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true;
  if (isEnvelope(error.response.data)) return false;
  return [404, 405, 501].includes(error.response.status);
}

function markLive() {
  live = true;
  mockMode.value = false;
}

function markMock() {
  // ACT: 演示模式只允许出现在开发构建，生产构建绝不把失败请求伪装成成功。
  if (!mockEnabled) return;
  live = false;
  mockMode.value = true;
}

async function callWithFallback<T>(liveCall: () => Promise<T>, mockCall: () => T | Promise<T>): Promise<T> {
  if (!mockEnabled) {
    markLive();
    return liveCall();
  }
  if (live === false && Date.now() - lastProbe < probeIntervalMs) {
    mockMode.value = true;
    return mockCall();
  }
  lastProbe = Date.now();
  try {
    const result = await liveCall();
    markLive();
    return result;
  } catch (error) {
    if (isGenuineApiError(error)) {
      markLive();
      throw error;
    }
    if (live === false || isMissingEndpoint(error)) {
      markMock();
      return mockCall();
    }
    throw error;
  }
}

async function unwrap<T>(request: Promise<AxiosResponse<Envelope<T>>>): Promise<T> {
  try {
    const { data } = await request;
    if (data.code !== 200 || data.data === null) throw new AssetRequestError(data.message || "素材操作失败", data.code);
    return data.data;
  } catch (error) {
    if (axios.isAxiosError(error) && isEnvelope(error.response?.data)) {
      const body = error.response.data as Envelope<{ code?: string; usages?: AssetUsage[]; checked?: AssetUsageCheckState } | null>;
      throw new AssetRequestError(body.message || error.message, error.response.status, body.data?.code, body.data?.usages ?? [], body.data?.checked);
    }
    throw error;
  }
}

export function toAssetError(error: unknown): AssetErrorInfo {
  if (error instanceof AssetRequestError) {
    return { message: error.message, status: error.status, code: error.code, usages: error.usages, checked: error.checked };
  }
  if (axios.isAxiosError<{ message?: string; data?: { code?: string; usages?: AssetUsage[]; checked?: AssetUsageCheckState } }>(error)) {
    return {
      message: error.response?.data?.message || error.message,
      status: error.response?.status,
      code: error.response?.data?.data?.code,
      usages: error.response?.data?.data?.usages ?? [],
      checked: error.response?.data?.data?.checked,
    };
  }
  return { message: error instanceof Error ? error.message : "素材操作失败", usages: [] };
}

function selectorParams(selector: AssetSelector) {
  // ACT: 全局库与项目目录无关，带上失效目录会把项目故障传染给全局库。
  const directory = selector.library === "global" ? undefined : selector.directory;
  return { library: selector.library, ...(directory ? { directory } : {}) };
}

export function getRoots(directory?: string) {
  return callWithFallback(
    () => unwrap<AssetRoots>(client.get("/roots", { params: directory ? { directory } : undefined })),
    () => mockRoots(directory),
  );
}

export function getTree(selector: AssetSelector, path?: string): Promise<AssetTreeResult> {
  return callWithFallback(
    () => unwrap<AssetTreeResult>(client.get("/tree", { params: { ...selectorParams(selector), ...(path ? { path } : {}) } })),
    () => mockTree(selector.library, path),
  );
}

export function listAssets(options: AssetListOptions): Promise<AssetListResult> {
  const { library, directory, ...rest } = options;
  return callWithFallback(
    () => unwrap<AssetListResult>(client.get("/list", { params: { ...selectorParams({ library, directory }), ...rest } })),
    () => mockList(options),
  );
}

export function createDirectory(selector: AssetSelector, path: string) {
  return callWithFallback(
    () => unwrap<{ path: string }>(client.post("/mkdir", { ...selectorParams(selector), path })),
    () => mockMkdir(selector.library, path),
  );
}

export function moveEntry(selector: AssetSelector, source: string, targetDirectory: string) {
  return callWithFallback(
    () => unwrap<{ path: string }>(client.post("/move", { ...selectorParams(selector), source, target: targetDirectory })),
    () => mockMove(selector.library, source, targetDirectory),
  );
}

export function renameEntry(selector: AssetSelector, path: string, name: string) {
  return callWithFallback(
    () => unwrap<{ path: string }>(client.post("/rename", { ...selectorParams(selector), path, name })),
    () => mockRename(selector.library, path, name),
  );
}

export function removeEntry(selector: AssetSelector, path: string, options: { permanent?: boolean; force?: boolean } = {}) {
  return callWithFallback(
    () => unwrap<{ path: string; trashId?: string }>(client.delete("/remove", { data: { ...selectorParams(selector), path, ...options } })),
    () => mockRemove(selector.library, path, options),
  );
}

export function getTrash(selector: AssetSelector): Promise<AssetTrashResult> {
  return callWithFallback(
    () => unwrap<AssetTrashResult>(client.get("/trash", { params: selectorParams(selector) })),
    () => mockTrash(selector.library),
  );
}

export function restoreTrash(selector: AssetSelector, id: string) {
  return callWithFallback(
    () => unwrap<{ path: string }>(client.post("/restore", { ...selectorParams(selector), id })),
    () => mockRestore(selector.library, id),
  );
}

export function purgeTrash(selector: AssetSelector, options: { id?: string; all?: boolean }) {
  return callWithFallback(
    () => unwrap<{ id?: string; all?: boolean }>(client.post("/purge", { ...selectorParams(selector), ...options })),
    () => mockPurge(selector.library, options),
  );
}

export function patchMeta(selector: AssetSelector, path: string, patch: { tags?: string[]; note?: string; favorite?: boolean }) {
  return callWithFallback(
    () => unwrap<{ path: string; tags: string[]; note: string; favorite: boolean }>(client.post("/meta", { ...selectorParams(selector), path, ...patch })),
    () => mockMeta(selector.library, path, patch),
  );
}

export function getUsages(selector: AssetSelector, path: string): Promise<AssetUsageCheck> {
  return callWithFallback(
    () => unwrap<AssetUsageCheck>(client.get("/usage", { params: { ...selectorParams(selector), path } })),
    () => ({ path, usages: [], checked: "complete" as const }),
  );
}

/** 批量引用预检；旧服务端没有该端点时由调用方回退为逐项 getUsages。 */
export async function getUsagesBatch(selector: AssetSelector, paths: string[]): Promise<{ items: AssetUsageCheck[] }> {
  if (!paths.length) return { items: [] };
  const result = await unwrap<{ items: AssetUsageCheck[] }>(client.post("/usage/batch", { ...selectorParams(selector), paths }));
  return { items: Array.isArray(result?.items) ? result.items : [] };
}

export type AssetImportSource =
  | { kind: "workspace"; path: string }
  | { kind: "library"; library: AssetLibraryKind; directory?: string; path: string };

/** 把工作区文件或另一个素材库的文件复制进目标库（重名由服务端自动追加序号）。 */
export function importAsset(target: AssetSelector, source: AssetImportSource, options: { targetDir?: string; name?: string } = {}) {
  return unwrap<{ path: string; revision?: string; size?: number }>(client.post("/import", {
    ...selectorParams(target),
    ...(options.targetDir !== undefined ? { targetDir: options.targetDir } : {}),
    ...(options.name ? { name: options.name } : {}),
    source,
  }));
}

function isContractMismatch(error: unknown) {
  return (error instanceof AssetRequestError && (error.status === 400 || error.status === 422))
    || (axios.isAxiosError(error) && (error.response?.status === 400 || error.response?.status === 422));
}

async function sequential<T>(items: T[], run: (item: T) => { path: string } | Promise<{ path: string }>): Promise<AssetBatchResult> {
  const results: AssetBatchResult["items"] = [];
  for (const item of items) {
    try {
      const result = await run(item);
      results.push({ ok: true, path: result.path });
    } catch (error) {
      const info = toAssetError(error);
      results.push({ ok: false, path: (item as { path?: string; source?: string }).path ?? (item as { source?: string }).source ?? "", error: info.message });
    }
  }
  return { items: results };
}

/** 批量移动（同目标目录）；服务端尚未支持数组时自动退回逐项调用，返回统一逐项结果。 */
export async function moveEntries(selector: AssetSelector, sources: string[], target: string): Promise<AssetBatchResult> {
  if (!sources.length) return { items: [] };
  try {
    const result = await callWithFallback(
      () => unwrap<AssetBatchResult>(client.post("/move", { ...selectorParams(selector), source: sources, target })),
      () => sequential(sources.map(source => ({ source })), item => mockMove(selector.library, item.source, target)),
    );
    if (Array.isArray(result?.items)) return normalizeMoveBatch(result);
  } catch (error) {
    if (!isContractMismatch(error)) throw error;
  }
  return normalizeMoveBatch(await sequential(sources.map(source => ({ source })), item => moveEntry(selector, item.source, target)));
}

/** 服务端批量 move 的 path 是原路径、target 是新路径；统一下发 target 供 UI 使用。 */
function normalizeMoveBatch(result: AssetBatchResult): AssetBatchResult {
  return { items: result.items.map(item => item.ok ? { ...item, target: item.target ?? item.path } : item) };
}

export async function removeEntries(selector: AssetSelector, paths: string[], options: { permanent?: boolean; force?: boolean } = {}): Promise<AssetBatchResult> {
  if (!paths.length) return { items: [] };
  try {
    const result = await callWithFallback(
      () => unwrap<AssetBatchResult>(client.delete("/remove", { data: { ...selectorParams(selector), path: paths, ...options } })),
      () => sequential(paths.map(path => ({ path })), item => mockRemove(selector.library, item.path, options)),
    );
    if (Array.isArray(result?.items)) return result;
  } catch (error) {
    if (!isContractMismatch(error)) throw error;
  }
  return sequential(paths.map(path => ({ path })), item => removeEntry(selector, item.path, options));
}

/** 批量修改同一组元数据（如统一收藏/取消收藏）。 */
export async function patchMetas(selector: AssetSelector, paths: string[], patch: { tags?: string[]; note?: string; favorite?: boolean }): Promise<AssetBatchResult> {
  if (!paths.length) return { items: [] };
  try {
    const result = await callWithFallback(
      () => unwrap<AssetBatchResult>(client.post("/meta", { ...selectorParams(selector), path: paths, ...patch })),
      () => sequential(paths.map(path => ({ path })), item => { mockMeta(selector.library, item.path, patch); return { path: item.path }; }),
    );
    if (Array.isArray(result?.items)) return result;
  } catch (error) {
    if (!isContractMismatch(error)) throw error;
  }
  return sequential(paths.map(path => ({ path })), item => patchMeta(selector, item.path, patch));
}

export function assetThumbnailUrl(selector: AssetSelector, path: string, size = 256) {
  if (mockEnabled && mockMode.value) return mockThumbnail(selector.library, path);
  const params = new URLSearchParams({ ...selectorParams(selector), path, size: String(size) });
  return `/api/assets/thumb?${params.toString()}`;
}

export function assetReadUrl(selector: AssetSelector, path: string) {
  if (mockEnabled && mockMode.value) return mockAssetUrl(selector.library, path);
  const params = new URLSearchParams({ ...selectorParams(selector), path });
  return `/api/assets/read?${params.toString()}`;
}

export function assetDownloadUrl(selector: AssetSelector, path: string) {
  const params = new URLSearchParams({ ...selectorParams(selector), path, download: "true" });
  return `/api/assets/read?${params.toString()}`;
}

export function isMockActive() {
  return mockMode.value;
}

function simulateProgress(onProgress: ((loaded: number, total: number) => void) | undefined, total: number) {
  return new Promise<void>(resolve => {
    let loaded = 0;
    const timer = setInterval(() => {
      loaded = Math.min(total, loaded + Math.max(1, Math.round(total / 4)));
      onProgress?.(loaded, total);
      if (loaded >= total) {
        clearInterval(timer);
        resolve();
      }
    }, 40);
  });
}

async function mockUpload(selector: AssetSelector, path: string, blob: Blob, onProgress?: (loaded: number, total: number) => void) {
  await simulateProgress(onProgress, Math.max(1, blob.size));
  return mockSave(selector.library, path, blob);
}

export function uploadAsset(selector: AssetSelector, path: string, blob: Blob, onProgress?: (loaded: number, total: number) => void) {
  if (mockEnabled && live === false && Date.now() - lastProbe < probeIntervalMs) {
    mockMode.value = true;
    return mockUpload(selector, path, blob, onProgress);
  }
  lastProbe = Date.now();
  return new Promise<{ path: string; revision?: string }>((resolve, reject) => {
    const query = new URLSearchParams({ ...selectorParams(selector), path, overwrite: "false" });
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/assets/save?${query.toString()}`);
    request.setRequestHeader("x-toonflow-workspace", "1");
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    request.onload = () => {
      let body: Envelope<{ path: string; revision?: string }> | undefined;
      try { body = JSON.parse(request.responseText) as Envelope<{ path: string; revision?: string }>; } catch { body = undefined; }
      if (request.status === 200 && body?.code === 200 && body.data) {
        markLive();
        onProgress?.(blob.size, blob.size);
        resolve(body.data);
        return;
      }
      const missingService = !body && (request.status === 0 || request.status === 404 || request.status === 405 || request.status === 501);
      if (missingService && mockEnabled) {
        markMock();
        void mockUpload(selector, path, blob, onProgress).then(resolve, reject);
        return;
      }
      if (missingService) {
        reject(new AssetRequestError(
          request.status === 0 ? "上传失败：无法连接素材服务，请检查网络后重试" : `上传失败：素材服务不可用（${request.status}）`,
          request.status,
        ));
        return;
      }
      const message = body?.message || `上传失败（${request.status}）`;
      if (body) markLive();
      reject(new AssetRequestError(message, request.status, (body?.data as { code?: string } | null)?.code));
    };
    request.onerror = () => {
      if (mockEnabled) {
        markMock();
        void mockUpload(selector, path, blob, onProgress).then(resolve, reject);
        return;
      }
      reject(new AssetRequestError("上传失败：无法连接素材服务，请检查网络后重试"));
    };
    request.send(blob);
  });
}

export function stopMockMode() {
  mockMode.value = false;
}

export type { AssetEntry, AssetLibraryKind };
