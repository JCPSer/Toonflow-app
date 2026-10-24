import axios from "axios";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { collectAssetReferences } from "@/pages/workspace/canvasFile";
import { assetCopyInProgress, readCanvasFiles } from "./canvasFiles";

type AssetNode = { id: string; data?: unknown };
export type NodeAssetCleanupOptions = {
  directory: () => string | undefined;
  getRetainedNodes: () => AssetNode[];
  signal?: AbortSignal;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type PendingRequest = { full: boolean; candidates: Set<string>; waiters: ((completed: boolean) => void)[] };

function isApiError(error: unknown, status: number, code: string) {
  return axios.isAxiosError<{ data?: { code?: string } }>(error)
    && error.response?.status === status && error.response.data?.data?.code === code;
}

export function createNodeAssetCleanup(options: NodeAssetCleanupOptions) {
  const queue = new Map<string, PendingRequest>();
  let running = false;

  function isCurrent(directory: string) {
    return !options.signal?.aborted && options.directory() === directory;
  }

  function runtimeReferences() {
    return collectAssetReferences(options.getRetainedNodes());
  }

  async function collectReferences(directory: string, files: ReturnType<typeof useWorkspaceFiles>) {
    // ACT: 崩溃残留的临时画布引用旧节点 ID，不能作为保护来源；.agent 与画布菜单的目录过滤保持一致。
    const canvases = await readCanvasFiles(files, "", { signal: options.signal, skipDirectories: [".agent"], skipPrefixes: [".toonflowCopy"], failOnMissing: true });
    if (!isCurrent(directory)) return;
    // ACT: 磁盘画布与运行时撤销/重做历史一次性扫描，共用访问集合与总工作量上限，超限则整轮放弃。
    return collectAssetReferences([...options.getRetainedNodes(), ...canvases.flatMap(canvas => canvas.data.nodes)]);
  }

  async function runRound(directory: string, candidates?: Set<string>) {
    if (!isCurrent(directory) || assetCopyInProgress()) return false;
    const files = useWorkspaceFiles(directory);
    let references: Set<string> | undefined;
    try {
      references = await collectReferences(directory, files);
    } catch (error) {
      if (isCurrent(directory)) console.warn("回收孤立节点素材目录已放弃：无法读取画布引用", error);
      return false;
    }
    if (!references || !isCurrent(directory)) return false;
    const referencesSet = references;

    let entries: Awaited<ReturnType<typeof files.list>>["entries"];
    try {
      ({ entries } = await files.list("assets", options.signal));
    } catch (error) {
      if (!isCurrent(directory)) return false;
      if (isApiError(error, 404, "ENOENT")) return true;
      console.warn("回收孤立节点素材目录已放弃：无法读取 assets 目录", error);
      return false;
    }
    if (!isCurrent(directory)) return false;

    // ACT: 只处理 UUID 目录；chat、chatImages、generated、imported 与手工目录天然不命中。
    const targets = entries
      .filter(entry => entry.type === "directory" && UUID.test(entry.name))
      .filter(entry => !candidates || candidates.has(entry.name.toLowerCase()))
      .filter(entry => !referencesSet.has(entry.name.toLowerCase()))
      .map(entry => entry.name);

    const failed: string[] = [];
    for (const name of targets) {
      if (!isCurrent(directory) || assetCopyInProgress()) return false;
      try {
        // ACT: 删除前重算运行时引用，挡住引用收集到删除执行之间粘贴或恢复节点的空隙。
        if (runtimeReferences().has(name.toLowerCase())) continue;
      } catch (error) {
        console.warn("回收孤立节点素材目录已放弃：无法复核运行时引用", error);
        return false;
      }
      try {
        await files.remove(`assets/${name}`, true);
      } catch (error) {
        if (isApiError(error, 404, "ENOENT")) continue;
        failed.push(name);
      }
    }
    if (failed.length) console.warn(`回收孤立节点素材目录：${failed.length} 个目录删除失败，将在下次触发时重试`, failed);
    return true;
  }

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.size) {
        const [directory, request] = queue.entries().next().value as [string, PendingRequest];
        queue.delete(directory);
        let completed = false;
        try {
          completed = await runRound(directory, request.full ? undefined : request.candidates);
        } catch (error) {
          console.warn("回收孤立节点素材目录失败", error);
        }
        for (const resolve of request.waiters) resolve(completed);
      }
    } finally {
      running = false;
    }
  }

  // candidates 为 undefined 表示全量清理；同一目录进行中再次请求时只合并候选并在下一轮补跑。
  function request(directory: string, candidates?: Iterable<string>) {
    return new Promise<boolean>(resolve => {
      if (!directory || !isCurrent(directory)) {
        resolve(false);
        return;
      }
      let pending = queue.get(directory);
      if (!pending) {
        pending = { full: false, candidates: new Set(), waiters: [] };
        queue.set(directory, pending);
      }
      if (candidates === undefined) pending.full = true;
      else for (const id of candidates) if (id) pending.candidates.add(id.toLowerCase());
      pending.waiters.push(resolve);
      void drain();
    });
  }

  function dispose() {
    for (const pending of queue.values()) for (const resolve of pending.waiters) resolve(false);
    queue.clear();
  }

  return { request, dispose };
}
