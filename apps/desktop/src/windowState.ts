import { readFileSync, writeAtomicSync } from "@toonflow/file";

/** 窗口普通状态下的几何（屏幕坐标，允许负值，例如主屏在主屏左侧的外接屏）。 */
export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  version: 1;
  normal: WindowFrame;
  maximized: boolean;
}

/** clamp 只需要显示器可用区域；保留 isPrimary 用于无交集时选择居中的屏幕。 */
export interface DisplayWorkArea {
  workArea: WindowFrame;
  isPrimary?: boolean;
}

export const MIN_WINDOW_WIDTH = 480;
export const MIN_WINDOW_HEIGHT = 320;
/** 无交集回退时给屏幕边缘预留的总边距，与启动默认窗口的留白保持一致。 */
export const WINDOW_MARGIN = 64;

const WINDOW_STATE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** 校验保存的普通窗口几何；任何字段不合法都视为没有保存值。 */
function parseFrame(value: unknown): WindowFrame | null {
  if (!isRecord(value)) return null;
  const { x, y, width, height } = value;
  if (!isInteger(x) || !isInteger(y)) return null;
  if (!isInteger(width) || width < MIN_WINDOW_WIDTH) return null;
  if (!isInteger(height) || height < MIN_WINDOW_HEIGHT) return null;
  return { x, y, width, height };
}

/**
 * 读取窗口状态。ENOENT、JSON 损坏、结构不合法一律返回 null，绝不抛错，
 * 让启动流程安静地回退到默认居中。
 */
export function loadWindowState(filePath: string): WindowState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isRecord(parsed)) return null;
    // ACT: 缺失 version 按当前版本兼容处理；显式写入其它版本时宁可丢弃也不误读。
    if (parsed.version !== undefined && parsed.version !== WINDOW_STATE_VERSION) return null;
    const normal = parseFrame(parsed.normal);
    if (!normal || typeof parsed.maximized !== "boolean") return null;
    return { version: WINDOW_STATE_VERSION, normal, maximized: parsed.maximized };
  } catch {
    return null;
  }
}

/**
 * 原子写入窗口状态。落盘位于退出路径上，写入失败只记录日志，不能打断退出流程。
 */
export function saveWindowState(filePath: string, state: WindowState): void {
  try {
    writeAtomicSync(filePath, JSON.stringify({
      version: WINDOW_STATE_VERSION,
      // ACT: 写入侧与 parseFrame 共用同一组下限，避免窗口被拖到小于 480×320 后
      // 整份几何在下次启动时被判为非法而丢弃（读写阈值必须一致）。
      normal: {
        ...state.normal,
        width: Math.max(state.normal.width, MIN_WINDOW_WIDTH),
        height: Math.max(state.normal.height, MIN_WINDOW_HEIGHT),
      },
      maximized: state.maximized,
    }));
  } catch (error) {
    console.error("保存窗口状态失败：", error);
  }
}

function intersectionArea(frame: WindowFrame, workArea: WindowFrame): number {
  const width = Math.min(frame.x + frame.width, workArea.x + workArea.width) - Math.max(frame.x, workArea.x);
  const height = Math.min(frame.y + frame.height, workArea.y + workArea.height) - Math.max(frame.y, workArea.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function isUsableWorkArea(workArea: WindowFrame): boolean {
  return [workArea.x, workArea.y, workArea.width, workArea.height].every(Number.isFinite)
    && workArea.width > 0 && workArea.height > 0;
}

function clampAxis(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 把保存的窗口几何修正到当前显示器布局。
 * - 选交集面积最大的显示器（按 workArea 计算，支持负坐标）
 * - 有交集：尺寸收缩到 workArea，位置仅越界方向修正（不把负坐标粗暴归零）
 * - 无交集：居中主屏，尺寸按 workArea 留出边距
 * - displays 为空：返回调用方的默认居中 frame
 */
export function clampToDisplays(
  frame: WindowFrame,
  displays: readonly DisplayWorkArea[],
  fallback: WindowFrame,
): WindowFrame {
  const usable = displays.filter(display => isUsableWorkArea(display.workArea));
  if (!usable.length) return fallback;

  let best: WindowFrame | undefined;
  let bestArea = 0;
  for (const display of usable) {
    const area = intersectionArea(frame, display.workArea);
    if (area > bestArea) {
      best = display.workArea;
      bestArea = area;
    }
  }

  if (!best) {
    // ACT: 外接屏被拔掉等场景下保存矩形可能完全在屏幕外；此时保留尺寸上限并居中主屏。
    const primary = usable.find(display => display.isPrimary) ?? usable[0]!;
    const { workArea } = primary;
    const width = Math.min(frame.width, Math.max(1, workArea.width - WINDOW_MARGIN));
    const height = Math.min(frame.height, Math.max(1, workArea.height - WINDOW_MARGIN));
    return {
      width,
      height,
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
    };
  }

  const width = Math.min(frame.width, best.width);
  const height = Math.min(frame.height, best.height);
  return {
    width,
    height,
    x: clampAxis(frame.x, best.x, best.x + best.width - width),
    y: clampAxis(frame.y, best.y, best.y + best.height - height),
  };
}
