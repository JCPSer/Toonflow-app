const TOMBSTONE_TTL = 60000;
const TOMBSTONE_LIMIT = 1000;
const SWEEP_INTERVAL = 120000;

// ACT: 单进程临时注册表，只保存 AbortController，不持有 req/res；进程退出即消失。
const runs = new Map<string, Set<AbortController>>();
// runId → 过期时间。用于 stop 早于 register 的竞态，不 404/409。
const tombstones = new Map<string, number>();

function sweepTombstones(now = Date.now()) {
  for (const [runId, expiry] of tombstones) if (expiry <= now) tombstones.delete(runId);
}

const sweepTimer = setInterval(sweepTombstones, SWEEP_INTERVAL);
sweepTimer.unref();

function takeTombstone(runId: string) {
  const expiry = tombstones.get(runId);
  if (expiry === undefined) return false;
  tombstones.delete(runId);
  return expiry > Date.now();
}

export function registerRun(runId: string, controller: AbortController) {
  // 命中未过期墓碑说明 stop 先到：立刻中止，让本次请求走空响应收尾。
  if (takeTombstone(runId)) controller.abort();
  let controllers = runs.get(runId);
  if (!controllers) runs.set(runId, controllers = new Set());
  controllers.add(controller);
}

export function detachRun(runId: string, controller: AbortController) {
  const controllers = runs.get(runId);
  if (!controllers) return;
  controllers.delete(controller);
  if (!controllers.size) runs.delete(runId);
}

export function stopRun(runId: string) {
  const controllers = runs.get(runId);
  if (controllers?.size) {
    for (const controller of controllers) controller.abort();
    return { stopped: true };
  }
  // ACT: 未命中不报错，墓碑兜住「stop 早于 register」；容量满时丢新墓碑，避免无界增长。
  if (!tombstones.has(runId)) {
    if (tombstones.size >= TOMBSTONE_LIMIT) sweepTombstones();
    if (tombstones.size >= TOMBSTONE_LIMIT) return { stopped: false };
  }
  tombstones.set(runId, Date.now() + TOMBSTONE_TTL);
  return { stopped: false };
}
