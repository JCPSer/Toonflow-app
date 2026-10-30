import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * 运行中克隆的条目前缀：`cut` 是本轮开始前的条目数（运行中的 `entryOffset`）或全量（本轮已结束、只是会话还没注销）。
 * 只做夹紧与前缀截取，条目原样保留——副本还原依赖 `toonflowReasoning`、附件、工具结果这些自定义条目，不能按消息重建。
 */
export function snapshotSessionEntries(entries: SessionEntry[], cut: number): SessionEntry[] {
  const end = Number.isFinite(cut) ? Math.max(0, Math.min(Math.floor(cut), entries.length)) : entries.length;
  return entries.slice(0, end);
}
