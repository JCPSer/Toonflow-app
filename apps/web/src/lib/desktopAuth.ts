import axios from "axios";

import { isDesktop } from "@/lib/platform";

/**
 * 桌面端系统验证（Touch ID，可回落登录密码）。
 *
 * ACT: 与原生对话框同一套两段式：验证弹窗由用户掌控，可能停留超过 WKWebView 的 60 秒无数据上限，
 * 所以 POST 只负责拉起弹窗，GET 轮询结果。
 * ACT: 调用方拿到 ok=false 时必须保持锁定，这里不提供任何绕过路径。
 */

export type DesktopAuthCode = "ok" | "cancelled" | "unavailable" | "failed" | "notInteractive" | "error";

export interface DesktopAuthResult {
  ok: boolean;
  code: DesktopAuthCode;
  message?: string;
}

interface Envelope<T> {
  code: number;
  data: T | null;
  message?: string;
}

interface AuthState {
  done: boolean;
  /** "1" 验证通过，"0" 未通过。 */
  value?: string | null;
  /** 未通过时的原因码。 */
  name?: string;
  error?: string;
}

const headers = { "x-toonflow-desktop": "1" };
const POLL_INTERVAL_MS = 350;

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
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

function normalizeCode(value: unknown): DesktopAuthCode {
  switch (value) {
    case "ok":
    case "cancelled":
    case "unavailable":
    case "failed":
    case "notInteractive":
      return value;
    default:
      return "error";
  }
}

/**
 * 探测当前安装包是否支持系统验证。
 * ACT: 不带 id 的 GET 只读能力位；非桌面/旧主进程返回 404，按不支持处理。
 */
export async function probeSystemAuthentication(): Promise<boolean> {
  if (!isDesktop) return false;
  try {
    const { data } = await axios.get<Envelope<{ available: boolean }>>("/api/desktop/auth", { headers });
    return data.code === 200 && data.data?.available === true;
  } catch {
    return false;
  }
}

/**
 * 调起系统验证并等待结果。
 * 非桌面环境、主进程未更新（接口 404）都归一成 unavailable，由上层提示「当前环境不支持」。
 */
export async function verifySystemIdentity(reason: string, signal?: AbortSignal): Promise<DesktopAuthResult> {
  if (!isDesktop) return { ok: false, code: "unavailable", message: "当前环境不支持系统验证" };
  let id: string;
  try {
    const { data } = await axios.post<Envelope<{ id: string }>>("/api/desktop/auth", { reason }, { headers, signal });
    if (data.code !== 200 || !data.data?.id) {
      return { ok: false, code: "error", message: data.message || "无法发起系统验证" };
    }
    id = data.data.id;
  } catch (error) {
    // ACT: 404 表示这个安装包的主进程还没有验证接口（未重启/旧版本），按不可用处理而不是失败。
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return { ok: false, code: "unavailable", message: "当前版本不支持系统验证，请更新或重启应用" };
    }
    const message = axios.isAxiosError(error) ? (error.response?.data as Envelope<unknown> | undefined)?.message : undefined;
    return { ok: false, code: "error", message: message || "无法发起系统验证" };
  }
  while (true) {
    await wait(POLL_INTERVAL_MS, signal);
    const { data: state } = await axios.get<Envelope<AuthState>>("/api/desktop/auth", { params: { id }, headers, signal });
    if (state.code !== 200 || !state.data) {
      throw new Error(state.message || "验证已失效，请重新验证");
    }
    if (!state.data.done) continue;
    if (state.data.error) throw new Error(state.data.error);
    const ok = state.data.value === "1";
    return { ok, code: ok ? "ok" : normalizeCode(state.data.name) };
  }
}
