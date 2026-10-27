import { existsSync, watch, type FSWatcher } from "node:fs";
import { posix } from "node:path";
import { internalAssetDirectories } from "./roots";

export type LibraryChangeEvent = { type: "change"; dirs: string[] } | { type: "gone" };

type Listener = (event: LibraryChangeEvent) => void;

type WatchState = {
  watcher: FSWatcher;
  listeners: Set<Listener>;
  pending: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  firstAt: number;
};

/** 同一库根的所有订阅者共用一个 watcher，避免多标签页重复监听。 */
const watchers = new Map<string, WatchState>();
/** watcher 创建失败只提示一次，网络卷等场景不在每次订阅时刷日志。 */
const warnedRoots = new Set<string>();

const DEBOUNCE_MS = 300;
const MAX_WAIT_MS = 2000;

/** 临时文件不改变库内容，忽略即可。 */
function isTemporaryName(name: string) {
  return name === ".DS_Store" || name.endsWith(".tmp") || name.startsWith("~$");
}

function shouldIgnore(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  // ACT: 内部目录保存索引、回收站和缩略图缓存，不能触发前端刷新。
  if (parts.some(part => internalAssetDirectories.has(part.toLocaleLowerCase()))) return true;
  return isTemporaryName(parts.at(-1) ?? "");
}

function normalizeFilename(filename: string | Buffer | null | undefined) {
  if (filename == null) return "";
  const raw = typeof filename === "string" ? filename : filename.toString("utf8");
  return raw.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function deliver(state: WatchState, event: LibraryChangeEvent) {
  // 单个订阅者抛错不能影响其他标签页的推送。
  for (const listener of [...state.listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.error("素材库变更订阅回调失败：", error);
    }
  }
}

function flush(root: string, state: WatchState) {
  state.timer = undefined;
  if (watchers.get(root) !== state) return;
  if (!state.pending.size) {
    state.firstAt = 0;
    return;
  }
  const dirs = [...state.pending];
  state.pending.clear();
  state.firstAt = 0;
  deliver(state, { type: "change", dirs });
}

function record(root: string, state: WatchState, directory: string) {
  if (!state.pending.size) state.firstAt = Date.now();
  state.pending.add(directory);
  if (state.timer) clearTimeout(state.timer);
  // ACT: 300ms 尾部防抖合并连续写入；但从第一条事件起最多等 2s，连续拷贝不会无限推迟。
  const wait = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (Date.now() - state.firstAt)));
  state.timer = setTimeout(() => flush(root, state), wait);
}

/** 移除 watcher；notifyGone 用于 watcher 出错或库根消失。 */
function dispose(root: string, state: WatchState, notifyGone: boolean) {
  if (watchers.get(root) !== state) return;
  watchers.delete(root);
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  state.pending.clear();
  state.firstAt = 0;
  // 先摘掉监听再 close，避免 close 过程中再次触发 error/gone。
  state.watcher.removeAllListeners();
  state.watcher.close();
  const listeners = [...state.listeners];
  state.listeners.clear();
  if (!notifyGone) return;
  for (const listener of listeners) {
    try {
      listener({ type: "gone" });
    } catch (error) {
      console.error("素材库变更订阅回调失败：", error);
    }
  }
}

function handleEvent(root: string, state: WatchState, filename: string | Buffer | null) {
  if (watchers.get(root) !== state) return;
  // ACT: 根目录被删/卸载时不一定触发 error，事件到达时顺带确认根目录仍在。
  if (!existsSync(root)) {
    dispose(root, state, true);
    return;
  }
  const relativePath = normalizeFilename(filename);
  // 部分平台对根目录自身的变更不给 filename，按根目录变更处理。
  if (!relativePath) {
    record(root, state, "");
    return;
  }
  if (shouldIgnore(relativePath)) return;
  const directory = posix.dirname(relativePath);
  // ACT: 只记父目录供前端定位；根目录下的条目父目录记为 ""。
  record(root, state, directory === "." ? "" : directory);
}

function unsubscribe(root: string, state: WatchState, listener: Listener) {
  if (watchers.get(root) !== state) return;
  state.listeners.delete(listener);
  if (!state.listeners.size) dispose(root, state, false);
}

/** 订阅某个库根（绝对路径）的变更；返回取消函数。同一 root 的多个订阅者共用一个 watcher。 */
export function subscribeLibraryChanges(root: string, listener: Listener): () => void {
  const existing = watchers.get(root);
  if (existing) {
    existing.listeners.add(listener);
    return () => unsubscribe(root, existing, listener);
  }

  let watcher: FSWatcher;
  try {
    watcher = watch(root, { recursive: true });
  } catch (error) {
    // ACT: 部分网络卷不支持 recursive 监听；退化为空订阅，让页面仍能打开并手动刷新。
    if (!warnedRoots.has(root)) {
      warnedRoots.add(root);
      console.warn(`素材库变更监听启动失败，将退化为手动刷新：${root}`, error);
    }
    return () => {};
  }

  const state: WatchState = { watcher, listeners: new Set([listener]), pending: new Set(), firstAt: 0 };
  watchers.set(root, state);
  watcher.on("change", (_eventType, filename) => handleEvent(root, state, filename));
  watcher.on("error", () => dispose(root, state, true));
  return () => unsubscribe(root, state, listener);
}
