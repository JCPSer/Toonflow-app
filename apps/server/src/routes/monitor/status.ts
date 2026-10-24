import { Router } from "express";
import { error, success } from "@/lib/responseFormat";
import u from "@/utils";
import { cachedStatus, friendlyMonitorError, type JsonRecord, parseMonitorBase, readMonitorJson, record } from "@/utils/monitor";

const router = Router();

function numeric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function normalizeSidecar(payload: JsonRecord) {
  const cpu = record(payload.cpu);
  const ram = record(payload.ram);
  const queue = record(payload.queue);
  const gpus = Array.isArray(payload.gpus) ? payload.gpus.map(record) : [];
  return {
    source: "sidecar" as const,
    system: {
      os: text(payload.platform),
      version: text(payload.version),
      cpuPercent: numeric(cpu.percent),
      cores: numeric(cpu.cores),
      freqMhz: numeric(cpu.freqMhz),
      ramTotal: numeric(ram.total),
      ramUsed: numeric(ram.used),
      ramPercent: numeric(ram.percent),
    },
    gpus: gpus.map((gpu, index) => {
      const total = numeric(gpu.memoryTotal);
      const used = numeric(gpu.memoryUsed);
      return {
        index: numeric(gpu.index) ?? index,
        name: text(gpu.name),
        type: "cuda",
        vramTotal: total,
        vramUsed: used,
        vramPercent: total && used !== undefined ? Math.round((used / total) * 100) : undefined,
        util: numeric(gpu.util),
        temperature: numeric(gpu.temperature),
        power: numeric(gpu.power),
      };
    }),
    queue: { running: numeric(queue.running), pending: numeric(queue.pending) },
  };
}

function normalizeComfy(system: JsonRecord, queue?: JsonRecord) {
  const info = record(system.system);
  const total = numeric(info.ram_total);
  const free = numeric(info.ram_free);
  const devices = Array.isArray(system.devices) ? system.devices.map(record) : [];
  return {
    source: "comfyui" as const,
    system: {
      os: text(info.os),
      version: text(info.comfyui_version),
      ramTotal: total,
      ramUsed: total !== undefined && free !== undefined ? total - free : undefined,
      ramPercent: total && free !== undefined ? Math.round(((total - free) / total) * 100) : undefined,
    },
    gpus: devices.map((device, index) => {
      const vramTotal = numeric(device.vram_total);
      const vramFree = numeric(device.vram_free);
      const vramUsed = vramTotal !== undefined && vramFree !== undefined ? vramTotal - vramFree : undefined;
      return {
        index: numeric(device.index) ?? index,
        name: text(device.name),
        type: text(device.type) ?? "cuda",
        vramTotal,
        vramUsed,
        vramPercent: vramTotal && vramUsed !== undefined ? Math.round((vramUsed / vramTotal) * 100) : undefined,
      };
    }),
    queue: {
      running: Array.isArray(queue?.queue_running) ? queue!.queue_running.length : undefined,
      pending: Array.isArray(queue?.queue_pending) ? queue!.queue_pending.length : undefined,
    },
  };
}

async function collectStatus(base: string) {
  try {
    const metrics = await readMonitorJson(`${base}/toonflow/metrics`, 1500);
    const normalized = normalizeSidecar(metrics);
    const missing: string[] = [];
    if (normalized.system.cpuPercent === undefined) missing.push("cpuPercent");
    for (const gpu of normalized.gpus) {
      if (gpu.util === undefined) missing.push("gpuUtil");
      if (gpu.temperature === undefined) missing.push("temperature");
      if (gpu.power === undefined) missing.push("power");
      break;
    }
    return { online: true, ...normalized, missing: [...new Set(missing)] };
  } catch {
    const [system, queue] = await Promise.all([
      readMonitorJson(`${base}/system_stats`, 2000),
      readMonitorJson(`${base}/queue`, 1500).catch(() => undefined),
    ]);
    const normalized = normalizeComfy(system, queue);
    // ACT: ComfyUI 自带接口没有 CPU/温度/利用率；显式标缺失，前端置灰而不是显示假数据。
    return { online: true, ...normalized, missing: ["cpuPercent", "gpuUtil", "temperature", "power"] };
  }
}

// ACT: 画布浮层每秒轮询一次；服务端统一代取，避免浏览器直连 ComfyUI 被 CORS 拦。
export default router.get("/", async (req, res) => {
  // ACT: 服务监听所有网卡，代理只对本机客户端开放，避免被内网其他机器当成取数器。
  if (!u.workspace.isLocalWorkspaceRequest(req)) return res.status(403).json(error("只能在本机查询监控状态", null, 403));
  const base = parseMonitorBase(req.query.url);
  if (!base) return res.status(400).json(error("请填写不含账号密码和查询参数的 HTTP(S) 地址"));

  try {
    res.set("Cache-Control", "no-store").json(success(await cachedStatus(base, collectStatus)));
  } catch (err) {
    res.status(502).json(error(`无法读取监控状态：${friendlyMonitorError(err)}`, null, 502));
  }
});
