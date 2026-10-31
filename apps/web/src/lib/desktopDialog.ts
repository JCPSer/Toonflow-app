import axios from "axios";

/**
 * 桌面原生对话框的客户端封装（两段式）。
 *
 * ACT: 为什么不能一次请求等结果。原生对话框要等用户关掉面板才产生返回值，而 WKWebView 对
 * 「一直没有数据到达」的请求有 60 秒上限（实测 61009ms 断流）。用户挑目录超过一分钟，请求必死：
 * 前端弹「请重试」，用户选好的路径也一起丢掉。改成 start 立即返回 id + 短轮询后，每个请求都是
 * 毫秒级，与对话框开多久无关。
 */

export type DesktopDialogKind = "directory" | "openFile" | "saveFile" | "providerFile";

interface Envelope<T> {
  code: number;
  data: T | null;
  message?: string;
}

interface DialogState {
  done: boolean;
  /** 目录/文件返回绝对路径；保存返回一次性 token；null 表示用户取消。 */
  value?: string | null;
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

/** 打开原生对话框并等待用户操作；返回 null 表示用户取消。 */
export async function pickDesktop(
  input: { kind: DesktopDialogKind; fileName?: string; extension?: string },
  signal?: AbortSignal,
): Promise<{ value: string | null; name?: string }> {
  const { data } = await axios.post<Envelope<{ id: string }>>("/api/desktop/dialog", input, { headers, signal });
  const id = data.data?.id;
  if (data.code !== 200 || !id) throw new Error(data.message || "无法打开选择窗口，请重试");
  while (true) {
    await wait(POLL_INTERVAL_MS, signal);
    const { data: state } = await axios.get<Envelope<DialogState>>("/api/desktop/dialog", { params: { id }, headers, signal });
    if (state.code !== 200 || !state.data) throw new Error(state.message || "选择已失效，请重新打开");
    if (!state.data.done) continue;
    if (state.data.error) throw new Error(state.data.error);
    return { value: state.data.value ?? null, name: state.data.name };
  }
}
