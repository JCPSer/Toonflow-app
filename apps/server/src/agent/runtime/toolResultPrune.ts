import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";

/** 保留最近 N 个用户轮的工具结果原文，更早的淘汰成指针。 */
export const PRUNE_KEEP_TURNS = 3;
/** 太短的结论性输出保留：淘汰它们省不到空间，却会让模型/用户丢掉一行答案。 */
export const PRUNE_MIN_CHARS = 400;
// 这些文本本身就是「指针」，再裁一次会让模型失去唯一的文件路径。
export const KEEP_POINTER_TEXT = /\[输出过大|\.agent\/artifacts\/|图片已移出本次模型上下文|\[工具结果已裁剪/;

/**
 * ACT: 「旧工具结果能不能淘汰成一行指针」只写一次，请求侧（上下文 microcompact）与磁盘侧（会话文件）共用，
 * 否则两边口径一旦漂移，就会出现「模型看不到、磁盘还在」或者「磁盘删了、模型还需要」的错位。
 */
export function pruneToolResultMessage(message: Message): { message: Message; pruned: boolean } {
  if (message.role !== "toolResult") return { message, pruned: false };
  const toolName = typeof message.toolName === "string" ? message.toolName.trim() : "";
  if (!toolName) return { message, pruned: false };
  // 错误结果往往很短且是关键线索，保留原文。
  if ((message as { isError?: boolean }).isError) return { message, pruned: false };
  // ACT: 旧版本或手工编辑过的会话可能没有 content 数组，这类条目直接放过，别让一次异常让整个淘汰永久失效。
  if (!Array.isArray(message.content)) return { message, pruned: false };
  const texts = message.content.filter((part): part is TextContent => part.type === "text");
  if (!texts.length || texts.some(part => KEEP_POINTER_TEXT.test(part.text))) return { message, pruned: false };
  const chars = texts.reduce((total, part) => total + part.text.length, 0);
  if (chars < PRUNE_MIN_CHARS) return { message, pruned: false };
  let markerAdded = false;
  const content: (TextContent | ImageContent)[] = [];
  for (const part of message.content) {
    if (part.type !== "text") { content.push(part); continue; }
    // 多条文本合并成一个指针，非文本部分保留原位置顺序。
    if (markerAdded) continue;
    markerAdded = true;
    content.push({ type: "text", text: `[工具结果已裁剪：${toolName}，约 ${chars} 字符；需要时重新调用该工具，或用 read 分页读取相关文件]` });
  }
  return { message: { ...message, content }, pruned: true };
}

type SessionEntryLike = { type: string; id?: string; message?: { role: string } };

/**
 * 把会话条目里 cut 之前的旧工具结果换成指针。返回新数组与淘汰条数（0 表示没有可淘汰的条目，调用方不必重写文件）。
 * 只改 message.content，条目的 id / parentId / 分支链原样保留。
 * branchIds 给定时只按「当前分支」的顺序算边界，非当前分支（回退/重发留下的旧条目）一律不动：
 * 按整个文件数用户轮会把边界往后推，误伤当前分支里仍属于最近几轮的工具结果。
 */
export function pruneSessionEntries<T extends SessionEntryLike>(entries: readonly T[], branchIds?: readonly string[]): { entries: T[]; pruned: number } {
  const byId = new Map(entries.flatMap((entry) => entry.id ? [[entry.id, entry] as const] : []));
  const ordered = branchIds?.length
    ? branchIds.flatMap((id) => byId.get(id) ?? [])
    : [...entries];
  const cut = pruneBoundary(ordered.map((entry) => entry.type === "message" ? entry.message?.role ?? entry.type : entry.type));
  if (!cut) return { entries: [...entries], pruned: 0 };
  const prunable = new Set(ordered.slice(0, cut).map((entry) => entry.id));
  let pruned = 0;
  const next = entries.map((entry) => {
    if (!entry.id || !prunable.has(entry.id) || entry.type !== "message") return entry;
    // ACT: 条目里的 message 可能是 BashExecutionMessage 等非标准形状，只有 toolResult 才进淘汰判定。
    if (entry.message?.role !== "toolResult") return entry;
    const result = pruneToolResultMessage(entry.message as unknown as Message);
    if (!result.pruned) return entry;
    pruned += 1;
    return { ...entry, message: result.message } as unknown as T;
  });
  return { entries: pruned ? next : [...entries], pruned };
}

/** 淘汰边界：最后 N 个用户轮之前的下标；不足 N+1 个用户轮时返回 0（不淘汰）。roles 按条目顺序给出。 */
export function pruneBoundary(roles: readonly string[]): number {
  let users = 0;
  for (let index = roles.length - 1; index >= 0; index--) {
    if (roles[index] !== "user") continue;
    if (++users > PRUNE_KEEP_TURNS) return index + 1;
  }
  return 0;
}
