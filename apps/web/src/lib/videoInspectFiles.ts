/**
 * 视频节点「Agent 查看视频」产物的集中清理入口。
 *
 * 产物目录是各节点自己的 `assets/<nodeId>/inspect/`，删目录要用节点手里的工作区文件实例，
 * 因此节点挂载时把清理函数登记到共享注册表（节点是独立 UMD 包，只能通过全局 Symbol 交换，
 * 与 nodeBusy/runningNodes 同一思路）。关窗/⌘Q 时由关闭闸门统一触发一次。
 */

const cleanupRegistryKey = Symbol.for("toonflow.videoInspectCleanups");
type Cleanup = () => Promise<void> | void;
/** 节点侧按目录引用计数登记，关窗时每个目录只清一次。 */
type CleanupEntry = { count: number; cleanup: Cleanup };

function registry(): Map<string, CleanupEntry> | undefined {
  return (globalThis as unknown as Record<symbol, Map<string, CleanupEntry> | undefined>)[cleanupRegistryKey];
}

/**
 * 清理全部已登记的视频查看产物。
 * ACT: 最多等 `timeoutMs`，任何失败都吞掉——清理只是收尾，绝不能拖住关闭闸门或影响落盘。
 */
export async function cleanupVideoInspectFiles(timeoutMs = 800) {
  const entries = [...(registry()?.values() ?? [])];
  if (!entries.length) return;
  const tasks = entries.map(entry => Promise.resolve().then(entry.cleanup).catch(() => {}));
  await Promise.race([Promise.all(tasks), new Promise(resolve => setTimeout(resolve, timeoutMs))]);
}
