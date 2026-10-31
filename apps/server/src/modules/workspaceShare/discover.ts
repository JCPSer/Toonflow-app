import { readdir, readFile, stat } from "@toonflow/file";
import { join, relative, sep } from "node:path";

// ACT: 与导入侧（routes/workspaces/clone.ts）保持同一套排除项，否则导出会把素材目录里的
// 大 JSON 当画布解析，既慢又可能误判。
const SKIP_DIRECTORIES = new Set(["assets", "library", "library-assets", ".library", ".trash", ".thumbs", ".toonflow", ".agent", "node_modules", ".git"]);
const MAX_CANVAS_BYTES = 20 * 1024 * 1024;
const MAX_DEPTH = 8;

export function isCanvasContent(content: Uint8Array) {
  try {
    const canvas = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
    if (canvas?.toonflowCanvas !== true || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges) || !canvas.viewport) return false;
    if (![canvas.viewport.x, canvas.viewport.y, canvas.viewport.zoom].every(Number.isFinite) || canvas.viewport.zoom <= 0) return false;
    const ids = new Set<string>();
    for (const node of canvas.nodes) {
      if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id)) return false;
      ids.add(node.id);
    }
    return canvas.edges.every((edge: { source?: unknown; target?: unknown }) => edge
      && typeof edge.source === "string" && typeof edge.target === "string" && ids.has(edge.source) && ids.has(edge.target));
  } catch {
    return false;
  }
}

/** 递归找出工程内所有画布 JSON，返回工作区相对路径（`/` 分隔）。 */
export async function findCanvases(root: string, directory = root, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  const found: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name.toLowerCase()) || entry.name.startsWith(".toonflowCopy")) continue;
      found.push(...await findCanvases(root, join(directory, entry.name), depth + 1));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    const path = join(directory, entry.name);
    // ACT: 先看大小再读，素材目录里动辄上百 MB 的 manifest 不该整体读进内存。
    const info = await stat(path).catch(() => null);
    if (!info || info.size > MAX_CANVAS_BYTES) continue;
    const content = await readFile(path).catch(() => null);
    if (!content || !isCanvasContent(content)) continue;
    found.push(relative(root, path).split(sep).join("/"));
  }
  return found.sort();
}
