import axios from "axios";
import { ref } from "vue";
import { defineStore } from "pinia";

/** 浮层位置；null 表示尚未手动拖动过，由面板按默认右下角摆放。 */
export type PanelFloatingPosition = { left: number | null; top: number | null };

export type PanelLayoutState = {
  visible: boolean;
  width: number;
  height: number;
  docked: boolean;
  floating: PanelFloatingPosition;
  /** 一次性迁移完成时间，避免多个客户端重复把旧本地布局写回全局。 */
  migratedAt?: number;
};

export type CanvasViewState = {
  snap: boolean;
  showEdges: boolean;
  showMap: boolean;
};

export type SessionStateShape = {
  panels: {
    asset: PanelLayoutState;
    agent: PanelLayoutState;
  };
  canvasView: CanvasViewState;
};

/**
 * 默认值必须与方案 4.5 一致。
 * Agent 默认可见，缺字段时深合并会把旧数据补齐，避免面板默认消失。
 */
export function defaultSessionState(): SessionStateShape {
  return {
    panels: {
      asset: { visible: false, width: 360, height: 0, docked: true, floating: { left: null, top: null } },
      agent: { visible: true, width: 420, height: 0, docked: false, floating: { left: null, top: null } },
    },
    canvasView: { snap: false, showEdges: true, showMap: false },
  };
}

const STATE_URL = "/api/sessionState/get";
const PATCH_URL = "/api/sessionState/patch";
const REQUEST_HEADERS = { "x-toonflow-workspace": "1" };
const SAVE_DELAY = 300;
const RETRY_DELAY = 2000;
const MAX_MERGE_DEPTH = 8;
const MAX_FLUSH_ROUNDS = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function splitPath(path: string) {
  return path.split(".").filter(Boolean);
}

type ValueKind = "null" | "array" | "object" | "scalar";

function valueKind(value: unknown): ValueKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  return "scalar";
}

/**
 * 把 patch 深合并到默认值上。
 * ACT: 对象缺字段时以默认值为准；null/undefined 视为“未设置”，不覆盖默认结构；
 * 数组整体替换。默认值为 null 的叶子表示“未设置”，接受标量。
 * 类型不匹配（对象 vs 标量、数组 vs 对象等）时回落到默认值，避免 `{"panels":5}`
 * 这类脏数据进入渲染后抛 TypeError 白屏。
 */
function mergeDefaults<T>(base: T, patch: unknown, depth = 0): T {
  if (patch === undefined || patch === null) return base;
  const baseKind = valueKind(base);
  const patchKind = valueKind(patch);
  if (baseKind === "null") return patchKind === "scalar" ? patch as T : base;
  if (baseKind !== patchKind) return base;
  if (baseKind === "array") return [...(patch as unknown[])] as T;
  if (baseKind === "scalar") return typeof base === typeof patch ? patch as T : base;
  // 两边都是普通对象，逐字段递归；深度上限防止异常嵌套。
  if (depth >= MAX_MERGE_DEPTH) return { ...base };
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    // 与接口侧一致，拒绝原型污染相关的键。
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const current = result[key];
    if (current === undefined) {
      // 默认结构里没有的键（如 migratedAt）直接接受，做一次浅拷贝。
      result[key] = Array.isArray(value) ? [...value] : isPlainObject(value) ? { ...value } : value;
      continue;
    }
    result[key] = mergeDefaults(current, value, depth + 1);
  }
  return result as T;
}

function setIn(target: Record<string, unknown>, keys: string[], value: unknown) {
  let current = target;
  for (let index = 0; index < keys.length - 1; index++) {
    const key = keys[index]!;
    const next = current[key];
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
      continue;
    }
    current = next;
  }
  current[keys[keys.length - 1]!] = value;
}

function deepHas(target: unknown, keys: string[]): boolean {
  let current: unknown = target;
  for (const key of keys) {
    if (!isPlainObject(current) || !Object.hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}

function hasPatch(patch: Record<string, unknown>): boolean {
  return Object.values(patch).some(value => isPlainObject(value) ? hasPatch(value) : true);
}

export const useSessionStateStore = defineStore("sessionState", () => {
  const state = ref<SessionStateShape>(defaultSessionState());
  const hydrated = ref(false);
  // init 失败时服务端来源未知，必须禁止迁移和 PATCH，否则本地旧值会覆盖服务端真实布局。
  const initFailed = ref(false);
  // 服务端返回的原始片段：只用于判断“某个 key 是否本来就存在”，不参与渲染。
  let source: Record<string, unknown> = {};
  // ACT: pending 始终是叶子 patch 的合并树，避免整棵 panels 覆盖其它客户端刚写入的字段。
  let pending: Record<string, unknown> = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushing: Promise<void> | undefined;
  let initTask: Promise<void> | undefined;

  function scheduleFlush(delay = SAVE_DELAY) {
    if (initFailed.value) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
  }

  function queueLeaf(keys: string[], value: unknown) {
    let target = pending;
    for (let index = 0; index < keys.length - 1; index++) {
      const key = keys[index]!;
      const next = target[key];
      if (!isPlainObject(next)) {
        const created: Record<string, unknown> = {};
        target[key] = created;
        target = created;
        continue;
      }
      target = next;
    }
    target[keys[keys.length - 1]!] = value;
  }

  /**
   * 更新内存中的状态。
   * path 使用点号路径（如 `panels.asset.width`）；hydrated 之前只改内存不发请求。
   */
  function set(path: string, value: unknown) {
    const keys = splitPath(path);
    if (!keys.length) return;
    setIn(state.value as unknown as Record<string, unknown>, keys, value);
    queueLeaf(keys, value);
    if (!hydrated.value || initFailed.value) return;
    scheduleFlush();
  }

  async function sendPatch(patch: Record<string, unknown>) {
    const { data } = await axios.patch<{ code: number; message?: string }>(
      PATCH_URL,
      { patch },
      { headers: REQUEST_HEADERS },
    );
    if (data?.code !== 200) throw new Error(data?.message || "保存会话状态失败");
    // ACT: 不整棵回写服务端返回的 state，避免覆盖本地尚未发送的新改动；
    // 服务端的宽高 clamp 会在下次启动 hydrate 时生效。
  }

  /**
   * 立即发送尚未落盘的 patch；失败时保留变更并稍后重试，不抛出以免阻塞关窗闸门。
   * ACT: 必须先等在飞请求完成再判断 pending，否则关窗时最后一次布局变更会随窗口一起丢。
   * 用带上限的循环代替递归，避免在飞请求与新改动交替时无限重入。
   */
  async function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!hydrated.value || initFailed.value) return;
    for (let round = 0; round < MAX_FLUSH_ROUNDS; round++) {
      if (flushing) {
        await flushing.catch(() => {});
        continue;
      }
      if (!hasPatch(pending)) return;
      const patch = pending;
      pending = {};
      flushing = sendPatch(patch);
      let failed = false;
      try {
        await flushing;
      } catch (error) {
        failed = true;
        console.warn("保存会话状态失败，稍后重试：", error);
        // 失败期间可能又有新改动，保留更新的 pending 并补回旧 patch。
        pending = mergeDefaults(patch, pending);
      } finally {
        flushing = undefined;
      }
      // ACT: 失败走退避重试，不能被尾部的一次普通排期覆盖成 300ms 高频重试。
      if (failed) {
        scheduleFlush(RETRY_DELAY);
        return;
      }
    }
    // 达到轮次上限说明期间持续有并发写入；交给下一次防抖继续，不在这里递归。
    if (hasPatch(pending)) scheduleFlush();
  }

  function hasSource(path: string) {
    // 初始化失败时服务端来源未知，按“已存在”处理，禁止迁移用本地旧值覆盖服务端布局。
    if (initFailed.value) return true;
    return deepHas(source, splitPath(path));
  }

  async function doInit() {
    try {
      const { data } = await axios.get<{ code: number; data?: { state?: unknown } | unknown; message?: string }>(
        STATE_URL,
        { headers: { ...REQUEST_HEADERS, "Cache-Control": "no-cache" }, timeout: 3000 },
      );
      if (data?.code !== 200) throw new Error(data?.message || "读取会话状态失败");
      const payload = data.data;
      const remote = isPlainObject(payload) && isPlainObject(payload.state) ? payload.state : payload;
      source = isPlainObject(remote) ? remote : {};
      // ACT: 深合并默认值，旧数据缺字段时不会让 Agent 面板消失。
      state.value = mergeDefaults(defaultSessionState(), source);
      initFailed.value = false;
    } catch (error) {
      // 接口不可用时照常挂载，使用默认布局；但服务端来源未知，禁止迁移和回写。
      console.warn("读取会话状态失败，使用默认布局：", error);
      initFailed.value = true;
      source = {};
      state.value = defaultSessionState();
    }
    // 初始化前发生的内存改动（理论上不会出现，页面在 init 之后才挂载）不能丢。
    if (hasPatch(pending)) state.value = mergeDefaults(state.value, pending);
    hydrated.value = true;
    if (!initFailed.value && hasPatch(pending)) scheduleFlush();
  }

  function init() {
    initTask ??= doInit();
    return initTask;
  }

  return {
    state,
    hydrated,
    initFailed,
    init,
    set,
    flush,
    hasSource,
  };
});
