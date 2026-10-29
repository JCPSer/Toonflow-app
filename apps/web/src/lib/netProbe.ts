/**
 * ACT: 本地服务的「全线超时」只有两种可能：浏览器同源连接被占满（请求根本没发出去），
 * 或服务端真的慢（发出去了等不到响应）。两者在 UI 上表现一致，靠猜会改错层。
 * 这里只做统计不改行为：同源在飞请求数、长连接数、等待首字节超过 200ms 的请求数，
 * 并把快照挂在 window.__toonflowNet 上，复现时读一次就能定性。
 * 生产构建同样保留——排障需要它，开销只有几次自增。
 */
type Sample = { url: string; ms: number };

const inflight = new Map<string, number>();
const streams = new Map<string, number>();
const slow: Sample[] = [];
let peakInflight = 0;
let peakStreams = 0;
let blocked = 0;
let total = 0;

const MAX_SLOW = 20;
const BLOCKED_MS = 200;
// 幂等标记：HMR / 二次 import 不能重复包装，否则一次请求会被算两遍、interval 也叠多个。
const installed = Symbol.for("toonflow.netProbe.installed");

function sameOrigin(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin ? parsed.pathname + parsed.search : undefined;
  } catch {
    return undefined;
  }
}

function key(url: string) {
  return sameOrigin(url)?.slice(0, 160) ?? "<cross-origin>";
}

function countMap(map: Map<string, number>) {
  let sum = 0;
  for (const value of map.values()) sum += value;
  return sum;
}

function enter(url: string) {
  const path = key(url);
  inflight.set(path, (inflight.get(path) ?? 0) + 1);
  total++;
  peakInflight = Math.max(peakInflight, countMap(inflight));
  return path;
}

function leave(path: string) {
  const next = (inflight.get(path) ?? 1) - 1;
  if (next > 0) inflight.set(path, next);
  else inflight.delete(path);
}

/** 服务端是否「迟到了」：只看首字节等待时间，不把传输时长算进去。 */
function recordWait(url: string, waitMs: number) {
  if (waitMs <= BLOCKED_MS) return;
  blocked++;
  slow.push({ url: url.slice(0, 200), ms: Math.round(waitMs) });
  if (slow.length > MAX_SLOW) slow.shift();
}

function snapshot() {
  return {
    // 同源在飞请求总数；HTTP/1.1 每源上限 6，长期贴着 6 就是连接池耗尽。
    inflight: countMap(inflight),
    // 已建立且未关闭的长连接（EventSource / 流式 fetch 显式登记）。
    streams: countMap(streams),
    peakInflight,
    peakStreams,
    // 首字节等待超过 200ms 的次数（服务端慢，或被浏览器排队）。
    blocked,
    total,
    byPath: Object.fromEntries([...inflight].sort((left, right) => right[1] - left[1])),
    streamsByPath: Object.fromEntries([...streams].sort((left, right) => right[1] - left[1])),
    slowest: [...slow].sort((left, right) => right.ms - left.ms).slice(0, 10),
  };
}

function reset() {
  inflight.clear();
  streams.clear();
  slow.length = 0;
  peakInflight = 0;
  peakStreams = 0;
  blocked = 0;
  total = 0;
}

function installFetch() {
  const original = window.fetch;
  if (!original) return;
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = enter(url);
    const startedAt = performance.now();
    return original.call(window, input as RequestInfo, init).then(response => {
      // 响应头到了就算服务端已应答；body 未读完的长流由 trackStream 单独统计。
      leave(path);
      recordWait(url, performance.now() - startedAt);
      return response;
    }, error => {
      leave(path);
      // 用户点「停止」触发的 abort 不是服务端慢，计进去会误导定性。
      if ((error as { name?: string })?.name !== "AbortError") recordWait(url, performance.now() - startedAt);
      throw error;
    });
  } as typeof window.fetch;
}

function installXhr() {
  const proto = window.XMLHttpRequest?.prototype;
  if (!proto) return;
  const send = proto.send;
  const open = proto.open;
  type XhrRecord = { path: string; url: string; startedAt: number; headersAt: number; aborted: boolean; left: boolean };
  const records = new WeakMap<XMLHttpRequest, XhrRecord>();
  proto.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    // open 不触发网络，只记下 url；计入在飞要等 send。
    records.set(this, { path: "", url: String(url), startedAt: 0, headersAt: 0, aborted: false, left: false });
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;
  proto.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
    const record = records.get(this);
    if (record) {
      record.path = enter(record.url);
      record.startedAt = performance.now();
      this.addEventListener("readystatechange", () => {
        // HEADERS_RECEIVED：拿到首字节的时刻，别把上传/下载时间算成排队。
        if (this.readyState === 2 && !record.headersAt) record.headersAt = performance.now();
      });
      this.addEventListener("abort", () => { record.aborted = true; });
      this.addEventListener("loadend", () => {
        if (record.left) return;
        record.left = true;
        leave(record.path);
        if (record.aborted) return;
        recordWait(record.url, (record.headersAt || performance.now()) - record.startedAt);
      }, { once: true });
    }
    return (send as (...args: unknown[]) => void).apply(this, args);
  } as typeof proto.send;
}

function addStream(url: string) {
  const path = key(url);
  streams.set(path, (streams.get(path) ?? 0) + 1);
  peakStreams = Math.max(peakStreams, countMap(streams));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (streams.get(path) ?? 1) - 1;
    if (next > 0) streams.set(path, next);
    else streams.delete(path);
  };
}

function installEventSource() {
  const original = window.EventSource;
  if (!original) return;
  window.EventSource = class ProbedEventSource extends original {
    private release: () => void;
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      this.release = addStream(String(url));
      this.addEventListener("error", () => {
        // 自动重连时 error 发生在 CONNECTING，此时连接还在，不能减计数。
        if (this.readyState === EventSource.CLOSED) this.release();
      });
    }
    close() {
      this.release();
      super.close();
    }
  } as typeof EventSource;
}

/** 长流（Agent NDJSON）在响应头之后仍占着一条连接，由调用方显式登记并在结束时释放。 */
export function trackStream(url: string) {
  return addStream(url);
}

/** 连续 3 秒同源在飞 ≥6 说明请求在浏览器侧排队，而不是服务端慢。 */
function installStallWatch() {
  let hot = 0;
  setInterval(() => {
    hot = countMap(inflight) >= 6 ? hot + 1 : 0;
    if (hot === 3) console.warn("[net] 同源在飞请求持续 ≥6，后续请求会在浏览器侧排队", snapshot());
  }, 1000);
}

const probeWindow = window as typeof window & { [installed]?: boolean; __toonflowNet?: unknown };
if (!probeWindow[installed]) {
  probeWindow[installed] = true;
  installFetch();
  installXhr();
  installEventSource();
  installStallWatch();
  probeWindow.__toonflowNet = { snapshot, reset };
}
