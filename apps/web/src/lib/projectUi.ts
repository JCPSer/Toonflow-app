import axios from "axios";
import useWorkspaceFiles from "./workspaceFiles";

/** 项目级 UI 状态目录。目录本身对文件树/Agent 隐藏，仅由 projectUi 读写。 */
export const PROJECT_UI_DIRECTORY = ".toonflow";
export const PROJECT_UI_FILE = ".toonflow/ui.json";
const WRITE_DEBOUNCE = 500;

type ProjectUiFile = {
  version: 1;
  lastCanvas: string | null;
  updatedAt: number;
};

/** 校验并规范化项目内相对路径：拒绝绝对路径、`..` 和空串。 */
function normalizeCanvasPath(path: string) {
  if (typeof path !== "string") throw new Error("画布路径必须是字符串");
  const trimmed = path.trim();
  if (!trimmed) throw new Error("画布路径不能为空");
  if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(trimmed)) throw new Error("画布路径必须是项目内的相对路径");
  const parts = trimmed.replaceAll("\\", "/").split("/");
  if (parts.some(part => part === "..")) throw new Error("画布路径不能包含上级目录");
  const normalized = parts.filter(part => part && part !== ".").join("/");
  if (!normalized) throw new Error("画布路径不能为空");
  return normalized;
}

function errorCode(error: unknown) {
  return (error as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code;
}

function isMissingFileError(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 404 || errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR";
}

function isAlreadyExistsError(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  return error.response?.status === 409 || errorCode(error) === "EEXIST";
}

// ACT: 每个项目目录一条写入队列，保证 mkdir 与 write 严格串行，避免并发创建/覆盖。
const queues = new Map<string, Promise<void>>();
const pending = new Map<string, ProjectUiFile["lastCanvas"]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function enqueue(directory: string, task: () => Promise<void>) {
  const previous = queues.get(directory) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(directory, next);
  const settle = () => { if (queues.get(directory) === next) queues.delete(directory); };
  next.then(settle, settle);
  return next;
}

/**
 * 读取上次打开的画布。
 * 文件不存在、内容损坏或格式不符都视作“没有记录”，返回 null；读取路径绝不写盘。
 * 网络/服务端其他错误向上抛出，由调用方提示，避免静默换画布。
 */
export async function readLastCanvas(directory: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const data = await useWorkspaceFiles(directory).readJson<Partial<ProjectUiFile> | null>(PROJECT_UI_FILE, signal);
    if (!data || typeof data !== "object" || data.version !== 1 || typeof data.lastCanvas !== "string") return null;
    try { return normalizeCanvasPath(data.lastCanvas); }
    catch { return null; }
  } catch (error) {
    if (signal?.aborted) throw error;
    // 文件缺失（首次打开项目）和 JSON 损坏都只表示没有可用指针。
    if (isMissingFileError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeProjectUi(directory: string, lastCanvas: ProjectUiFile["lastCanvas"]) {
  const files = useWorkspaceFiles(directory);
  try { await files.mkdir(PROJECT_UI_DIRECTORY); }
  catch (error) {
    // 并发写入或目录已存在时 mkdir 返回 EEXIST，直接继续写文件。
    if (!isAlreadyExistsError(error)) throw error;
  }
  const value: ProjectUiFile = { version: 1, lastCanvas, updatedAt: Date.now() };
  await files.writeJson(PROJECT_UI_FILE, value);
}

/**
 * 记录上次打开的画布（500ms 防抖 + 按目录串行写入）。
 * 传 null 表示清空记录（例如删除了最后一个画布）。
 */
export function writeLastCanvas(directory: string, path: string | null) {
  if (!directory) return;
  const lastCanvas = path === null ? null : normalizeCanvasPath(path);
  pending.set(directory, lastCanvas);
  const timer = timers.get(directory);
  if (timer) clearTimeout(timer);
  timers.set(directory, setTimeout(() => {
    timers.delete(directory);
    void flushLastCanvas(directory).catch(error => console.warn("保存上次画布失败", error));
  }, WRITE_DEBOUNCE));
}

/** 立即落盘指定项目的待写指针；没有待写内容时等待已有队列完成。 */
export function flushLastCanvas(directory: string): Promise<void> {
  const timer = timers.get(directory);
  if (timer) { clearTimeout(timer); timers.delete(directory); }
  if (!pending.has(directory)) return queues.get(directory) ?? Promise.resolve();
  const lastCanvas = pending.get(directory)!;
  pending.delete(directory);
  return enqueue(directory, () => writeProjectUi(directory, lastCanvas));
}

/** 退出工作区时冲刷全部待写指针（尽力而为，失败只记录日志）。 */
export async function flushAllLastCanvas() {
  await Promise.all([...new Set([...pending.keys(), ...queues.keys()])].map(directory =>
    flushLastCanvas(directory).catch(error => console.warn("保存上次画布失败", error))));
}
