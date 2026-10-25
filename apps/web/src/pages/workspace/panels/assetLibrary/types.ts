import { ref } from "vue";
import type { AssetLibraryKind, AssetSortField, AssetSortOrder, AssetView } from "@/stores/assetLibrary";

export type { AssetLibraryKind, AssetSortField, AssetSortOrder, AssetView };

export type AssetEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  category: string;
  dataType?: string;
  size: number;
  mtimeMs: number;
  tags: string[];
  note: string;
  favorite: boolean;
  childCount?: number;
  /** 索引里还有、磁盘上已不存在（在 Finder 里被删或移走）。 */
  missing?: boolean;
};

export type AssetTreeNode = AssetEntry & {
  id: string;
  library: AssetLibraryKind;
  isLeaf: boolean;
  root?: boolean;
  /** 首页分组模式：该节点所属的项目目录（根节点与项目节点没有）。 */
  directory?: string;
  /** 首页分组模式下「项目」这个分组节点本身。 */
  group?: boolean;
  /** 首页分组模式下的项目节点（点击即切换当前项目）。 */
  projectRoot?: boolean;
  disabled?: boolean;
};

export type AssetListResult = {
  items: AssetEntry[];
  total: number;
  truncated: boolean;
  nextCursor?: string;
  rebuilding?: boolean;
  /** 索引里还有、磁盘上已消失的条目（外部删除/移动）。 */
  missing?: AssetEntry[];
  missingTotal?: number;
};
export type AssetTreeResult = { items: AssetEntry[]; truncated: boolean };
export type AssetTrashItem = { id: string; path: string; name: string; deletedAt: number; size: number; isDirectory: boolean };
export type AssetTrashResult = { items: AssetTrashItem[]; usage: number };
export type AssetUsage = { kind: "canvas" | "session"; name: string; file: string; nodeId?: string };
/** 引用检查结果：partial/unavailable 表示没扫完，删除前需要额外确认。 */
export type AssetUsageCheckState = "complete" | "partial" | "unavailable";
export type AssetUsageCheck = { path: string; usages: AssetUsage[]; checked: AssetUsageCheckState };
/** 兼容服务端两种根描述：root 为绝对路径；path 用于 project fallback（library-assets）。 */
export type AssetRootInfo = { library: AssetLibraryKind; root?: string; path?: string; exists?: boolean; fallback?: boolean };
export type AssetRoots = { global: AssetRootInfo; project: AssetRootInfo | null };
export type AssetBatchError = string | { status?: number; code?: string; message?: string; usages?: AssetUsage[]; checked?: AssetUsageCheckState };
export type AssetBatchItem = { ok: boolean; path: string; target?: string; error?: AssetBatchError };
export type AssetBatchResult = { items: AssetBatchItem[] };

export function batchErrorMessage(error: AssetBatchError | undefined) {
  if (!error) return "";
  return typeof error === "string" ? error : error.message || error.code || "操作失败";
}

export function batchErrorUsages(error: AssetBatchError | undefined) {
  return typeof error === "string" || !error ? [] : error.usages ?? [];
}

export function batchErrorChecked(error: AssetBatchError | undefined): AssetUsageCheckState | undefined {
  return typeof error === "string" || !error ? undefined : error.checked;
}

export type AssetSelector = { library: AssetLibraryKind; directory?: string };
export type AssetListOptions = AssetSelector & {
  path?: string;
  cursor?: string;
  limit?: number;
  sort?: AssetSortField;
  order?: AssetSortOrder;
  query?: string;
  type?: string;
  favorite?: boolean;
};

export type AssetDragPayload = { library: AssetLibraryKind; path: string; name: string; type: "file" | "directory" };
export type AssetMoveTarget = { library: AssetLibraryKind; path: string };

/** 库内移动使用独立 payload；画布只接受 application/toonflow-asset（复制语义）。 */
export const ASSET_MOVE_DRAG_TYPE = "application/x-toonflow-asset-move";
export const ASSET_CANVAS_DRAG_TYPE = "application/toonflow-asset";

/** dragover 阶段浏览器读不到 getData，用同文档的活动 payload 提前判断落点是否合法。 */
export const activeAssetDrag = ref<AssetDragPayload>();

export type AssetErrorInfo = { message: string; status?: number; code?: string; usages: AssetUsage[]; checked?: AssetUsageCheckState };

export function parentAssetPath(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

export function joinAssetPath(directory: string, name: string) {
  return directory ? `${directory}/${name}` : name;
}

export function isSameOrDescendant(path: string, ancestor: string) {
  return path === ancestor || (!!ancestor && path.startsWith(`${ancestor}/`));
}

export function canDropInto(source: AssetDragPayload, target: AssetMoveTarget, targetType: "file" | "directory" | "root") {
  if (targetType === "file") return false;
  if (source.library !== target.library) return false;
  if (!source.path) return false;
  if (target.path && isSameOrDescendant(target.path, source.path)) return false;
  return parentAssetPath(source.path) !== target.path;
}

export function normalizeAssetPath(path?: string) {
  const normalized = (path ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return normalized === "." ? "" : normalized;
}

export function assetKind(entry: Pick<AssetEntry, "type" | "category">): "directory" | "image" | "video" | "audio" | "document" | "other" {
  if (entry.type === "directory") return "directory";
  if (entry.category === "image" || entry.category === "video" || entry.category === "audio" || entry.category === "document") return entry.category;
  return "other";
}

export function isPreviewable(entry: AssetEntry) {
  const kind = assetKind(entry);
  return kind === "image" || kind === "video" || kind === "audio";
}

export function formatAssetSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function setInternalDrag(event: DragEvent, payload: AssetDragPayload) {
  activeAssetDrag.value = payload;
  if (!event.dataTransfer) return;
  event.dataTransfer.effectAllowed = payload.type === "file" ? "copyMove" : "move";
  event.dataTransfer.setData(ASSET_MOVE_DRAG_TYPE, JSON.stringify(payload));
}

export function clearAssetDrag() {
  activeAssetDrag.value = undefined;
}

export function setCanvasDragPayload(event: DragEvent, payload: AssetDragPayload, directory?: string) {
  if (!event.dataTransfer || payload.type !== "file") return;
  event.dataTransfer.setData(ASSET_CANVAS_DRAG_TYPE, JSON.stringify({ library: payload.library, directory, path: payload.path }));
}

export function readInternalDrag(event: DragEvent): AssetDragPayload | undefined {
  const raw = event.dataTransfer?.getData(ASSET_MOVE_DRAG_TYPE);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<AssetDragPayload>;
    if ((parsed.library === "project" || parsed.library === "global") && typeof parsed.path === "string" && typeof parsed.name === "string"
      && (parsed.type === "file" || parsed.type === "directory")) {
      return { library: parsed.library, path: parsed.path, name: parsed.name, type: parsed.type };
    }
  } catch {
    // 非本面板写入的数据按普通拖拽忽略。
  }
  return undefined;
}

export function hasInternalDrag(event: DragEvent) {
  return event.dataTransfer?.types.includes(ASSET_MOVE_DRAG_TYPE) ?? false;
}

export function hasFileDrag(event: DragEvent) {
  return event.dataTransfer?.types.includes("Files") ?? false;
}
