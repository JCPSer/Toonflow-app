import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { dirname, join } from "node:path";
import conf from "@/utils/conf";

/** 会话状态是任意层级的 JSON 对象；内部一律使用无原型对象承载，避免原型污染。 */
export type SessionState = Record<string, unknown>;

type JsonObject = Record<string, unknown>;

const stateFile = join(dirname(conf.path), "sessionState.json");
const maxDepth = 8;
const maxBytes = 64 * 1024;
const minPanelSize = 200;
const maxPanelSize = 10000;
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

/** 首次懒加载的缓存与并发去重；PATCH 只替换引用，不在原对象上就地修改。 */
let state: JsonObject | null = null;
let loading: Promise<JsonObject> | null = null;
/** 模块级写盘链：所有落盘严格串行，避免读-改-写互相覆盖。 */
let writeChain: Promise<void> = Promise.resolve();
/** 模块级变更链：冷加载期间的并发 PATCH 也必须串行读取最新状态后再合并赋值。 */
let patchChain: Promise<void> = Promise.resolve();

function isPlainObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function createObject(): JsonObject {
  return Object.create(null) as JsonObject;
}

/** 用 defineProperty 写入，避免 "__proto__" 这类键名触发原型 setter。 */
function setKey(target: JsonObject, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function invalid(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}

function tooLarge(message: string) {
  return Object.assign(new Error(message), { status: 413 });
}

function pathLabel(path: string[]) {
  return path.length ? path.join(".") : "(根)";
}

/** 方案 4.3：面板宽高取整并限制在 200–10000；0 表示“未设置/自动”，保持原值。 */
function normalizePanelSize(key: string, value: number, path: string[]) {
  if (path.length === 3 && path[0] === "panels" && (key === "width" || key === "height") && value !== 0) {
    return Math.min(maxPanelSize, Math.max(minPanelSize, Math.round(value)));
  }
  return value;
}

/** 校验并克隆一个替换值（数组整体替换时使用）；数组里的 null 是普通 JSON 值，不表示删除。 */
function cloneValue(value: unknown, depth: number, path: string[]): unknown {
  if (depth > maxDepth) throw tooLarge(`会话状态嵌套超过 ${maxDepth} 层：${pathLabel(path)}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid(`会话状态包含非有限数值：${pathLabel(path)}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => cloneValue(item, depth + 1, [...path, String(index)]));
  if (isPlainObject(value)) {
    const result = createObject();
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw invalid(`会话状态不允许字段：${[...path, key].join(".")}`);
      setKey(result, key, cloneValue(item, depth + 1, [...path, key]));
    }
    return result;
  }
  throw invalid(`会话状态包含不支持的类型：${pathLabel(path)}`);
}

/** 按方案 4.3 合并：普通对象递归、数组整体替换、null 删除键。 */
function applyPatch(target: JsonObject, patch: JsonObject, depth: number, path: string[]) {
  for (const [key, value] of Object.entries(patch)) {
    const nextPath = [...path, key];
    if (forbiddenKeys.has(key)) throw invalid(`会话状态不允许字段：${nextPath.join(".")}`);
    if (value === null) {
      Reflect.deleteProperty(target, key);
      continue;
    }
    if (isPlainObject(value)) {
      if (depth >= maxDepth) throw tooLarge(`会话状态嵌套超过 ${maxDepth} 层：${nextPath.join(".")}`);
      let child = target[key];
      if (!isPlainObject(child)) {
        child = createObject();
        setKey(target, key, child);
      }
      applyPatch(child as JsonObject, value, depth + 1, nextPath);
      continue;
    }
    if (Array.isArray(value)) {
      setKey(target, key, cloneValue(value, depth + 1, nextPath));
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw invalid(`会话状态包含非有限数值：${nextPath.join(".")}`);
      setKey(target, key, normalizePanelSize(key, value, nextPath));
      continue;
    }
    if (typeof value === "string" || typeof value === "boolean") {
      setKey(target, key, value);
      continue;
    }
    throw invalid(`会话状态包含不支持的类型：${nextPath.join(".")}`);
  }
}

/** 读取落盘内容时做同一套结构与深度校验；落盘内容不可信，危险字段直接丢弃。 */
function restoreValue(value: unknown, depth: number, path: string[]): unknown {
  if (depth > maxDepth) throw tooLarge(`会话状态嵌套超过 ${maxDepth} 层：${pathLabel(path)}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid(`会话状态包含非有限数值：${pathLabel(path)}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => restoreValue(item, depth + 1, [...path, String(index)]));
  if (isPlainObject(value)) {
    const result = createObject();
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) continue;
      setKey(result, key, restoreValue(item, depth + 1, [...path, key]));
    }
    return result;
  }
  throw invalid(`会话状态包含不支持的类型：${pathLabel(path)}`);
}

async function readStateFile(): Promise<JsonObject> {
  let text: string;
  try {
    text = await readFile(stateFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return createObject();
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (!isPlainObject(parsed)) throw invalid("会话状态根节点必须是普通对象");
    const restored = restoreValue(parsed, 0, []) as JsonObject;
    if (Buffer.byteLength(JSON.stringify(restored)) > maxBytes) throw tooLarge(`会话状态序列化后不能超过 ${maxBytes / 1024} KB`);
    return restored;
  } catch (error) {
    // ACT: 损坏的状态文件不能阻塞接口；丢弃后回到空状态，下一次写入会覆盖它。
    console.warn("会话状态文件无效，已忽略：", stateFile, error);
    return createObject();
  }
}

async function loadState(): Promise<JsonObject> {
  if (state) return state;
  loading ??= readStateFile().then((value) => (state = value));
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

function persist(serialized: string) {
  const write = writeChain.then(async () => {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeAtomic(stateFile, serialized, { mode: 0o600 });
  });
  // ACT: 单次落盘失败不能污染队列，后续写入仍要按序执行。
  writeChain = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

/** 读取会话状态；首次调用懒加载，文件不存在时视为空对象。 */
export async function getSessionState(): Promise<SessionState> {
  return loadState();
}

/** 合并并持久化会话状态；校验失败时内存与文件都不变，落盘失败时内存已更新、下次写入会覆盖文件。 */
export async function patchSessionState(patch: Record<string, unknown>): Promise<SessionState> {
  if (!isPlainObject(patch)) throw invalid("会话状态 patch 必须是普通对象");
  // ACT: 冷加载时两个并发 PATCH 会拿到同一份旧状态，必须把读取、克隆、合并和赋值整段串行化，
  // 否则后一次赋值会用只含自己字段的副本覆盖前一次的结果。
  const operation = patchChain.then(async () => {
    const merged = cloneValue(await loadState(), 0, []) as JsonObject;
    applyPatch(merged, patch, 0, []);
    const serialized = JSON.stringify(merged);
    if (Buffer.byteLength(serialized) > maxBytes) throw tooLarge(`会话状态序列化后不能超过 ${maxBytes / 1024} KB`);
    state = merged;
    await persist(serialized);
    return merged;
  });
  // ACT: 单次失败不能阻断后续 PATCH；调用方仍拿到自己的 rejection。
  patchChain = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}
