import type { ShareManifest } from "./types";

export type SharePhase = "collecting" | "compressing" | "packing" | "importing" | "writing";

export interface ShareTaskState {
  id: string;
  cwd: string;
  phase: SharePhase;
  done: number;
  total: number;
  bytes: number;
  currentFile: string;
  /** 引用到但找不到的文件；导出不因此失败，只在结束时提示。 */
  missing: string[];
  /** 压缩后反而变大的文件，保留原样。 */
  skippedLarger: string[];
  finished: boolean;
  error?: string;
  cancelled?: boolean;
  result?: { manifest: ShareManifest; path: string };
  settledAt?: number;
}

type ShareTask = ShareTaskState & { controller: AbortController };

// ACT: 与媒体生成任务同形态：单进程内存表，结束 5 分钟后清理，重启不恢复。
const tasks = new Map<string, ShareTask>();
const MAX_TASKS = 1000;
const RETENTION_MS = 300000;

function cleanup() {
  const now = Date.now();
  for (const [id, task] of tasks) if (task.settledAt !== undefined && task.settledAt + RETENTION_MS <= now) tasks.delete(id);
}

const timer = setInterval(cleanup, 30000);
timer.unref();

export function createTask(cwd: string): ShareTask {
  cleanup();
  if (tasks.size >= MAX_TASKS) throw Object.assign(new Error("分享任务过多，请稍后重试"), { status: 429 });
  const task: ShareTask = {
    id: crypto.randomUUID(),
    cwd,
    phase: "collecting",
    done: 0,
    total: 0,
    bytes: 0,
    currentFile: "",
    missing: [],
    skippedLarger: [],
    finished: false,
    controller: new AbortController(),
  };
  tasks.set(task.id, task);
  return task;
}

export function settle(task: ShareTask, patch: Partial<ShareTaskState> & { error?: string } = {}) {
  if (task.finished) return;
  Object.assign(task, patch, { finished: true, settledAt: Date.now() });
}

export function status(cwd: string, id: string): ShareTaskState | null {
  cleanup();
  const task = tasks.get(id);
  if (!task || task.cwd !== cwd) return null;
  const { controller: _controller, ...state } = task;
  return state;
}

export function cancel(cwd: string, id: string) {
  const task = tasks.get(id);
  if (!task || task.cwd !== cwd || task.finished) return;
  task.controller.abort(new Error("分享已取消"));
}
