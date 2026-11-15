/**
 * ACT: 模型偶尔会在 thinking/正文里陷入重复循环（例如连续输出上万次「写。」），
 * 前端需要按增量反复解析 Markdown，内容越大主线程越容易被打满，最后连停止按钮都点不动。
 * 这里在流式增量上做极保守的重复检测：最近 4 KB 内不同 4-gram ≤ 16 种、
 * 任一 8-gram 出现 ≥ 64 次、或 ≥ 20 行且 90% 是同一行，才视为可疑；
 * 且必须连续两次检查（相隔约 2 KB）都命中才真正中止，避免合法的重复表格/占位内容被误杀。
 * 返回稳定的 reason code，由调用方负责翻译成用户文案。
 */

/** 命中原因；调用方据此翻译，guard 本身不返回展示文案。 */
export type OutputLoopReason = "loop" | "too-large";

/** 只看最近这么多字符。 */
export const LOOP_WINDOW_CHARS = 4096;
/** 不足一窗不判定，避免短回复误伤。 */
export const LOOP_MIN_CHARS = 4096;
/** 4 KB 内不同 4-gram 不超过这个数，视为重复循环。正常中英文正文远高于此。 */
export const LOOP_MAX_UNIQUE_GRAMS = 16;
/** 长句/stanza 检测的 gram 长度。 */
export const LOOP_GRAM_SIZE = 8;
/** 窗口内任一 8-gram 出现这么多次，视为同一长句或 stanza 在重复。 */
export const LOOP_MAX_GRAM_REPEAT = 64;
/** 单块硬上限：模型输出上限再大，也不该单块刷到 15 万字符。 */
export const MAX_BLOCK_CHARS = 150_000;
/** 每新增这么多字符才检查一次，控制 CPU。 */
const CHECK_EVERY_CHARS = 2048;
/** 连续命中这么多次检查才中止；两次检查窗相隔约 CHECK_EVERY_CHARS。 */
export const LOOP_REQUIRED_HITS = 2;

type BlockState = { tail: string; total: number; checkedAt: number; hits: number };

/** 最近窗口内不同 4-gram 的数量。 */
export function countUniqueGrams(text: string): number {
  if (text.length < 4) return text.length;
  const grams = new Set<string>();
  for (let index = 0; index + 4 <= text.length; index++) grams.add(text.slice(index, index + 4));
  return grams.size;
}

/** 长句重复：窗口内至少 20 行且 90% 是同一行。覆盖「整段同一句话反复输出」而 4-gram 种类够多的情况。 */
export function isRepeatedLineLoop(text: string): boolean {
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  if (lines.length < 20) return false;
  const counts = new Map<string, number>();
  let max = 0;
  for (const line of lines) {
    const next = (counts.get(line) ?? 0) + 1;
    counts.set(line, next);
    if (next > max) max = next;
  }
  return max >= lines.length * 0.9;
}

/** 窗口内任一固定长度 gram 的最大出现次数（允许重叠）。 */
export function maxGramOccurrences(text: string, size = LOOP_GRAM_SIZE): number {
  if (size < 1 || text.length < size) return 0;
  const counts = new Map<string, number>();
  let max = 0;
  for (let index = 0; index + size <= text.length; index++) {
    const gram = text.slice(index, index + size);
    const next = (counts.get(gram) ?? 0) + 1;
    counts.set(gram, next);
    if (next > max) max = next;
  }
  return max;
}

/** 单次 4 KB 窗口是否具备循环特征。 */
export function isLoopWindow(text: string): boolean {
  return countUniqueGrams(text) <= LOOP_MAX_UNIQUE_GRAMS
    || isRepeatedLineLoop(text)
    || maxGramOccurrences(text) >= LOOP_MAX_GRAM_REPEAT;
}

export class OutputLoopGuard {
  private blocks = new Map<string, BlockState>();

  /** 返回 reason code 表示命中；undefined 表示继续。 */
  push(blockId: string, delta: string): OutputLoopReason | undefined {
    if (!delta) return undefined;
    let state = this.blocks.get(blockId);
    if (!state) {
      state = { tail: "", total: 0, checkedAt: 0, hits: 0 };
      this.blocks.set(blockId, state);
    }
    state.total += delta.length;
    state.tail += delta;
    // ACT: 只在超过两窗时裁剪，避免每个 token 都复制一次 4 KB。
    if (state.tail.length > LOOP_WINDOW_CHARS * 2) state.tail = state.tail.slice(-LOOP_WINDOW_CHARS);
    if (state.total > MAX_BLOCK_CHARS) return "too-large";
    if (state.tail.length < LOOP_MIN_CHARS) return undefined;
    if (state.total - state.checkedAt < CHECK_EVERY_CHARS) return undefined;
    state.checkedAt = state.total;
    const window = state.tail.slice(-LOOP_WINDOW_CHARS);
    if (!isLoopWindow(window)) {
      state.hits = 0;
      return undefined;
    }
    // ACT: 合法内容（重复表格行、占位 JSON）也可能短暂命中一次；连续两窗都命中才认为模型真的卡住了。
    state.hits++;
    return state.hits >= LOOP_REQUIRED_HITS ? "loop" : undefined;
  }
}
