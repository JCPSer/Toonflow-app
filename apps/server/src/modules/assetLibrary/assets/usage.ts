import { lstat, opendir, readFile, readdir } from "@toonflow/file";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import conf from "@/modules/platformCore/conf";
import type { AssetLibraryKind } from "./roots";
import { normalizeAssetPath } from "./roots";

export type AssetUsage = { kind: "canvas" | "session"; name: string; file: string; nodeId?: string };
export type AssetUsageChecked = "complete" | "partial" | "unavailable";
export type AssetUsageResult = { checked: AssetUsageChecked; usages: AssetUsage[] };
export type AssetUsageTarget = { path: string; isDirectory?: boolean };
export type AssetUsageBatchItem = { path: string; checked: AssetUsageChecked; usages: AssetUsage[] };

type Budget = { files: number; bytes: number; deadline: number; partial: boolean };

const maxFiles = 2000;
const maxBytes = 64 * 1024 * 1024;
const maxMilliseconds = 5000;
const skippedDirectories = new Set(["assets", "library", "library-assets", "node_modules", ".git", ".agent", ".toonflow", ".library", ".trash", ".thumbs"]);

function isSkippedName(name: string) {
  return skippedDirectories.has(name.toLocaleLowerCase()) || name.startsWith(".toonflowCopy");
}

function budgetExceeded(budget: Budget) {
  if (Date.now() > budget.deadline || budget.files >= maxFiles || budget.bytes >= maxBytes) {
    budget.partial = true;
    return true;
  }
  return false;
}

type Target = { relativePath: string; isDirectory: boolean };

/** 画布字符串匹配：project 库按 library/<rel>，全局库按 <rel> / assets/<rel>；目录按前缀。 */
type CanvasMatcher = { exact: Map<string, Target>; prefixes: { prefix: string; target: Target }[] };

function buildCanvasMatcher(kind: AssetLibraryKind, libraryPath: string, targets: Target[]): CanvasMatcher {
  const exact = new Map<string, Target>();
  const prefixes: { prefix: string; target: Target }[] = [];
  for (const target of targets) {
    const base = kind === "project" ? `${normalizeAssetPath(libraryPath)}/${target.relativePath}` : target.relativePath;
    const candidates = new Set([base, `./${base}`]);
    // 全局文件常以数据目录相对的 assets/... 形式出现在旧画布中。
    if (kind === "global") {
      candidates.add(`assets/${target.relativePath}`);
      candidates.add(`./assets/${target.relativePath}`);
    }
    for (const candidate of candidates) exact.set(candidate.replace(/\\/g, "/"), target);
    if (target.isDirectory) {
      for (const candidate of candidates) prefixes.push({ prefix: `${candidate.replace(/\\/g, "/")}/`, target });
    }
  }
  return { exact, prefixes };
}

function matchCanvasValue(value: unknown, matcher: CanvasMatcher, found: Set<Target>, depth = 0): void {
  if (depth > 64) return;
  if (typeof value === "string") {
    const normalized = value.replace(/\\/g, "/");
    const exact = matcher.exact.get(normalized);
    if (exact) found.add(exact);
    for (const { prefix, target } of matcher.prefixes) if (normalized.startsWith(prefix)) found.add(target);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) matchCanvasValue(item, matcher, found, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) matchCanvasValue(item, matcher, found, depth + 1);
  }
}

/** 会话只认 source.kind="asset" 的结构化引用，不再用裸字符串/子串匹配，避免同名文件误报。 */
function matchSessionValue(value: unknown, kind: AssetLibraryKind, targets: Target[], found: Set<Target>, depth = 0): void {
  if (depth > 64) return;
  if (Array.isArray(value)) {
    for (const item of value) matchSessionValue(item, kind, targets, found, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.kind === "asset" && typeof record.path === "string") {
    const library = record.library === "project" ? "project" : "global";
    if (library === kind) {
      const path = normalizeAssetPath(record.path);
      if (path) {
        for (const target of targets) {
          if (path === target.relativePath || (target.isDirectory && path.startsWith(`${target.relativePath}/`))) found.add(target);
        }
      }
    }
  }
  for (const item of Object.values(record)) matchSessionValue(item, kind, targets, found, depth + 1);
}

async function collectJsonFiles(root: string, relativePath: string, depth: number, files: string[], budget: Budget, signal?: AbortSignal) {
  if (depth > 32 || budgetExceeded(budget)) return;
  signal?.throwIfAborted();
  const directory = relativePath ? join(root, relativePath) : root;
  const entries = await opendir(directory);
  for await (const entry of entries) {
    if (budgetExceeded(budget)) return;
    signal?.throwIfAborted();
    const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!isSkippedName(entry.name)) await collectJsonFiles(root, child, depth + 1, files, budget, signal);
      continue;
    }
    if (!entry.isFile() || isSkippedName(entry.name) || extname(entry.name).toLocaleLowerCase() !== ".json") continue;
    files.push(child);
    budget.files++;
  }
}

async function scanCanvases(workspace: string, kind: AssetLibraryKind, libraryPath: string, targets: Target[],
  usages: Map<Target, AssetUsage[]>, budget: Budget, signal?: AbortSignal) {
  if (!targets.length) return;
  const matcher = buildCanvasMatcher(kind, libraryPath, targets);
  const files: string[] = [];
  await collectJsonFiles(workspace, "", 0, files, budget, signal);
  for (const file of files) {
    if (budgetExceeded(budget)) break;
    signal?.throwIfAborted();
    const absolute = join(workspace, file);
    const info = await lstat(absolute).catch(() => null);
    if (!info?.isFile()) continue;
    if (info.size > maxBytes - budget.bytes) {
      budget.partial = true;
      break;
    }
    budget.bytes += info.size;
    const text = await readFile(absolute, "utf8");
    let canvas: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) canvas = parsed as Record<string, unknown>;
    } catch {
      // ACT: 画布候选解析失败时无法排除引用，按部分检查处理，删除必须二次确认。
      if (text.includes("toonflowCanvas") || text.includes('"nodes"')) budget.partial = true;
      continue;
    }
    if (!canvas || (canvas.toonflowCanvas !== true && !Array.isArray(canvas.nodes))) continue;
    const name = basename(file, extname(file));
    const matchedNodes = new Set<Target>();
    if (Array.isArray(canvas.nodes)) {
      for (const node of canvas.nodes) {
        if (!node || typeof node !== "object") continue;
        const id = (node as { id?: unknown }).id;
        if (typeof id !== "string") continue;
        const found = new Set<Target>();
        matchCanvasValue(node, matcher, found);
        for (const target of found) {
          (usages.get(target) ?? usages.set(target, []).get(target)!).push({ kind: "canvas", name, file, nodeId: id });
          matchedNodes.add(target);
        }
      }
    }
    const { nodes: _nodes, ...rest } = canvas;
    const restFound = new Set<Target>();
    matchCanvasValue(rest, matcher, restFound);
    for (const target of restFound) {
      if (matchedNodes.has(target)) continue;
      (usages.get(target) ?? usages.set(target, []).get(target)!).push({ kind: "canvas", name, file });
    }
  }
}

async function directoryExists(directory: string) {
  const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  });
  return info?.isDirectory() === true;
}

async function childDirectories(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  return entries.filter(entry => entry.isDirectory()).map(entry => join(root, entry.name));
}

/** 全局库没有当前项目时，已知会话位置包括数据目录、workspaces/* 与 singleAgent/*。 */
async function defaultSessionDirectories() {
  const dataDirectory = dirname(conf.path);
  const candidates = [join(dataDirectory, ".agent", "sessions")];
  for (const workspace of await childDirectories(join(dataDirectory, "workspaces"))) {
    candidates.push(join(workspace, ".agent", "sessions"));
  }
  for (const agent of await childDirectories(join(dataDirectory, "singleAgent"))) {
    candidates.push(join(agent, ".agent", "sessions"));
  }
  const existing: string[] = [];
  for (const directory of candidates) if (await directoryExists(directory)) existing.push(directory);
  return existing;
}

async function scanSessions(directories: string[], kind: AssetLibraryKind, targets: Target[], usages: Map<Target, AssetUsage[]>,
  budget: Budget, signal?: AbortSignal) {
  if (!targets.length) return;
  for (const directory of directories) {
    if (budgetExceeded(budget)) return;
    const entries = await opendir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    if (!entries) continue;
    for await (const entry of entries) {
      if (budgetExceeded(budget)) return;
      signal?.throwIfAborted();
      if (!entry.isFile() || extname(entry.name).toLocaleLowerCase() !== ".jsonl") continue;
      budget.files++;
      const absolute = join(directory, entry.name);
      const fileInfo = await lstat(absolute).catch(() => null);
      if (!fileInfo?.isFile()) continue;
      if (fileInfo.size > maxBytes - budget.bytes) {
        budget.partial = true;
        return;
      }
      budget.bytes += fileInfo.size;
      const text = await readFile(absolute, "utf8");
      const found = new Set<Target>();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          matchSessionValue(JSON.parse(line), kind, targets, found);
        } catch {
          budget.partial = true;
        }
        if (found.size === targets.length) break;
      }
      if (!found.size) continue;
      const dataRelative = relative(dirname(conf.path), absolute);
      const file = dataRelative.startsWith("..") ? absolute.split(sep).join("/") : dataRelative.split(sep).join("/");
      for (const target of found) {
        (usages.get(target) ?? usages.set(target, []).get(target)!).push({ kind: "session", name: basename(entry.name, ".jsonl"), file });
      }
    }
  }
}

function dedupeUsages(usages: AssetUsage[]) {
  const seen = new Set<string>();
  return usages.filter(usage => {
    const key = `${usage.file}|${usage.nodeId ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 一次扫描同时匹配多个素材路径，共享 2000 文件 / 64 MB / 5 秒预算。
 * 全局库没有 directory 时扫描已知会话位置；这些位置都不存在时返回 "unavailable"，
 * 由调用方提示用户引用检查不可用，而不是静默当成“无引用”。
 */
export async function findAssetUsageBatch(options: {
  workspace?: string;
  kind: AssetLibraryKind;
  libraryPath: string;
  targets: AssetUsageTarget[];
  signal?: AbortSignal;
}): Promise<{ items: AssetUsageBatchItem[]; checked: AssetUsageChecked }> {
  const normalized = options.targets.map(target => ({
    relativePath: normalizeAssetPath(target.path), isDirectory: target.isDirectory === true,
  }));
  const unique = [...new Map(normalized.filter(target => target.relativePath).map(target => [
    `${target.relativePath}|${target.isDirectory}`, target,
  ])).values()];
  const usageMap = new Map<Target, AssetUsage[]>(unique.map(target => [target, []]));
  const budget: Budget = { files: 0, bytes: 0, deadline: Date.now() + maxMilliseconds, partial: false };
  let unavailable = false;
  try {
    if (unique.length) {
      if (options.workspace) {
        await scanCanvases(options.workspace, options.kind, options.libraryPath, unique, usageMap, budget, options.signal);
        await scanSessions([join(options.workspace, ".agent", "sessions")], options.kind, unique, usageMap, budget, options.signal);
      } else if (options.kind === "global") {
        const directories = await defaultSessionDirectories();
        if (directories.length) await scanSessions(directories, options.kind, unique, usageMap, budget, options.signal);
        else unavailable = true;
      } else {
        unavailable = true;
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn("素材引用检查未完成：", options.targets.map(target => target.path), error);
    budget.partial = true;
  }
  const overall: AssetUsageChecked = unavailable ? "unavailable" : budget.partial ? "partial" : "complete";
  return {
    checked: overall,
    items: options.targets.map(target => {
      const key = { relativePath: normalizeAssetPath(target.path), isDirectory: target.isDirectory === true };
      return { path: target.path, checked: overall, usages: dedupeUsages(usageMap.get(unique.find(item =>
        item.relativePath === key.relativePath && item.isDirectory === key.isDirectory) ?? key) ?? []) };
    }),
  };
}

/**
 * 单路径引用检查（兼容旧调用）。全局库没有 directory 且找不到会话目录时返回 unavailable。
 */
export async function findAssetUsages(options: {
  workspace?: string;
  kind: AssetLibraryKind;
  libraryPath: string;
  path: string;
  isDirectory?: boolean;
  signal?: AbortSignal;
}): Promise<AssetUsageResult> {
  const result = await findAssetUsageBatch({
    workspace: options.workspace,
    kind: options.kind,
    libraryPath: options.libraryPath,
    targets: [{ path: options.path, isDirectory: options.isDirectory }],
    signal: options.signal,
  });
  const item = result.items[0];
  return { checked: item?.checked ?? result.checked, usages: item?.usages ?? [] };
}
