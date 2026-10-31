/**
 * 桌面原生对话框的两段式会话表。
 *
 * ACT: 为什么不能直接 await。原生对话框的响应要等用户关掉面板才产生，而 WKWebView 对「一直没有
 * 任何数据」的请求有 60 秒上限（实测 61009ms 断流）。用户挑目录超过一分钟，请求必死，前端弹
 * 「请重试」，用户选好的路径也一并丢失。改成 start 立即返回 id、前端短轮询取结果后，每个 HTTP
 * 请求都是毫秒级，与对话框开多久无关。
 */

export type DesktopDialogKind = "directory" | "openFile" | "saveFile" | "providerFile";

export interface DesktopDialogState {
  done: boolean;
  /** 选中的路径；保存对话框返回的是一次性 token；null 表示用户取消。 */
  value?: string | null;
  /** 供应商文件等场景附带的展示名。 */
  name?: string;
  error?: string;
}

interface DialogSession extends DesktopDialogState {
  id: string;
  startedAt: number;
  finishedAt?: number;
}

/** 未取走的会话最多保留 5 分钟；已完成的再保留 30 秒供重复轮询。 */
const PENDING_TTL_MS = 5 * 60 * 1000;
const DONE_TTL_MS = 30 * 1000;
const MAX_SESSIONS = 16;

const sessions = new Map<string, DialogSession>();

function sweep(now: number) {
  for (const [id, session] of sessions) {
    const expired = session.done
      ? now - (session.finishedAt ?? now) > DONE_TTL_MS
      : now - session.startedAt > PENDING_TTL_MS;
    if (expired) sessions.delete(id);
  }
  if (sessions.size <= MAX_SESSIONS) return;
  // 兜底：数量超限时按开始时间清掉最老的已结束会话。
  const finished = [...sessions.values()].filter(session => session.done).sort((a, b) => a.startedAt - b.startedAt);
  for (const session of finished) {
    if (sessions.size <= MAX_SESSIONS) break;
    sessions.delete(session.id);
  }
}

/**
 * 发起一次对话框。`run` 内部负责真正拉起原生对话框，返回值里的 `value` 原样交给前端。
 * 同步抛出的 409 用于阻止第二个面板同时弹出（原生面板没有互斥，叠加后用户会看到多个）。
 */
export function startDesktopDialog(run: () => Promise<{ value: string | null; name?: string }>): string {
  const now = Date.now();
  sweep(now);
  for (const session of sessions.values()) {
    if (!session.done) throw Object.assign(new Error("已有选择窗口正在操作，请先完成或取消"), { status: 409 });
  }
  const id = crypto.randomUUID();
  const session: DialogSession = { id, done: false, startedAt: now };
  sessions.set(id, session);
  // ACT: 故意不 await：请求要立刻返回，结果写进会话由前端轮询取走。
  void run().then(
    result => {
      session.done = true;
      session.value = result.value;
      session.name = result.name;
      session.finishedAt = Date.now();
    },
    error => {
      session.done = true;
      session.error = error instanceof Error && error.message ? error.message : "打开选择窗口失败";
      session.finishedAt = Date.now();
    },
  );
  return id;
}

/** 读取会话状态；id 不存在（过期/重启）返回 undefined，前端按「已失效」处理。 */
export function readDesktopDialog(id: unknown): DesktopDialogState | undefined {
  if (typeof id !== "string" || !id) return undefined;
  sweep(Date.now());
  const session = sessions.get(id);
  if (!session) return undefined;
  return { done: session.done, value: session.value, name: session.name, error: session.error };
}
