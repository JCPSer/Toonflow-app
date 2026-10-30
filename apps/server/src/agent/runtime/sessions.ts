import { z } from "zod";
import { basename, dirname, resolve } from "node:path";
import { open, readFile, readdir, stat, unlink } from "@toonflow/file";
import { calculateContextTokens, createAgentSession, estimateTokens, getLastAssistantUsage, parseSessionEntries, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession, FileEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentEvent, AgentMention, AgentSubAgent, AgentToolCall } from "@/agent/runtime/types";
import { agentMentionsSchema } from "@/agent/runtime/mentions";
import { createAgentModel } from "@/agent/runtime/model";
import { createAgentResources, createAgentSettings } from "@/agent/runtime/resources";
import { snapshotSessionEntries } from "@/agent/runtime/cloneSnapshot";
import { getAgentHost } from "@/agent/host";
import { getReadableFileMimeType } from "@toonflow/formats/documentFormats";
import { thinkingLevels } from "@toonflow/formats/modelReasoning";

export const agentAttachmentsSchema = z
  .array(
    z.strictObject({
      name: z.string().min(1).max(255),
      path: z.string().min(1).max(4096),
      mimeType: z.string().min(1).max(128),
    }).refine(attachment => /^(?:(image|video)\/[a-zA-Z0-9.+-]+|text\/plain)$/.test(attachment.mimeType)
      || !!getReadableFileMimeType(attachment.path, attachment.mimeType), "不支持此附件格式")
      .transform(attachment => ({ ...attachment, mimeType: getReadableFileMimeType(attachment.path, attachment.mimeType) ?? attachment.mimeType }))
  )
  .max(20);

export const agentNodeBindingSchema = z.strictObject({
  canvasId: z.string().min(1).max(256),
  nodeId: z.string().min(1).max(256),
});

export type AgentNodeBinding = z.infer<typeof agentNodeBindingSchema>;

export type ActiveAgentSession = {
  history: SessionManager; session?: AgentSession; send: (event: AgentEvent) => void;
  entryOffset: number; tools: Map<string, AgentToolCall>;
  abort(): Promise<void>;
};
type SessionMessage = {
  id: string; entryId: string; role: "user" | "assistant"; content: string; replyTo?: string; error?: string;
  streaming?: boolean;
  attachments?: z.infer<typeof agentAttachmentsSchema>; report?: { file: string; name: string };
  mentions?: AgentMention[];
  parts: ({ id: string; type: "text" | "thinking"; content: string; collapsed?: boolean } | { id: string; type: "tool"; tool: AgentToolCall })[];
};
// ACT: 复用正在运行的 SDK 会话，文件锁仍由 run 持有；多进程部署时需共享会话所有权。
const activeSessions = new Map<string, ActiveAgentSession>();
const sessionKey = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);

export function getActiveAgentSession(path: string) {
  return activeSessions.get(sessionKey(path));
}

export function hasPendingAgentQuestion(active: ActiveAgentSession, visited = new Set<ActiveAgentSession>()): boolean {
  if (visited.has(active)) return false;
  visited.add(active);
  const tools = [...active.tools.values()];
  if (tools.some(tool => tool.status === "running" && tool.question)) return true;
  if (!tools.some(tool => tool.name === "subAgent" && tool.status === "running")) return false;
  const path = active.history.getSessionFile()!;
  return active.history.getEntries().some(entry => {
    if (entry.type !== "custom" || entry.customType !== "toonflowSubAgent") return false;
    const file = (entry.data as AgentSubAgent | undefined)?.file;
    if (!file || !/^[\w-]+\.jsonl$/.test(file)) return false;
    const child = getActiveAgentSession(resolve(dirname(path), file));
    return !!child && getParentSessionFile(child.history) === basename(path) && hasPendingAgentQuestion(child, visited);
  });
}

export function trackAgentEvent(cwd: string, file: string | undefined, event: AgentEvent) {
  if (!file || event.type !== "question") return;
  const active = getActiveAgentSession(resolve(cwd, ".agent/sessions", file));
  const tool = active?.tools.get(event.toolCallId);
  if (tool) tool.question = { callId: event.callId, title: event.title, question: event.question, options: event.options, fields: event.fields };
}

export function registerAgentSession(path: string, active: ActiveAgentSession) {
  const key = sessionKey(path);
  activeSessions.set(key, active);
  return () => { if (activeSessions.get(key) === active) activeSessions.delete(key); };
}

export function getSubAgentInfo(history: SessionManager) {
  return history.getEntries().find(entry => entry.type === "custom" && entry.customType === "toonflowSubAgentInfo") as
    (SessionEntry & { data: AgentSubAgent }) | undefined;
}

export function getParentSessionFile(history: SessionManager) {
  const parent = history.getHeader()?.parentSession;
  return parent && getSubAgentInfo(history) ? basename(parent) : undefined;
}

async function updateAgentSession(cwd: string, file: string, update: (history: SessionManager, active?: ActiveAgentSession) => void | Promise<void>) {
  if (!/^[\w-]+\.jsonl$/.test(file)) throw new Error("父会话标识无效");
  const { path } = await getAgentHost().workspace.resolveWorkspacePath(cwd, `.agent/sessions/${file}`);
  const active = getActiveAgentSession(path);
  if (active) return update(active.history, active);
  const release = getAgentHost().workspace.lockWorkspaceFiles([path]);
  try {
    const pending = update(SessionManager.open(path, dirname(path), cwd));
    if (pending) await pending;
  } finally { release(); }
}

export async function updateSubAgent(cwd: string, parentFile: string, agent: AgentSubAgent) {
  await updateAgentSession(cwd, parentFile, (history, active) => {
    history.appendCustomEntry("toonflowSubAgent", agent);
    active?.send({ type: "subAgent", agent });
  });
}

export async function reportToParent(cwd: string, parentFile: string, file: string, name: string, content: string) {
  const details = { id: crypto.randomUUID(), parentFile, file, name, content };
  const message = `子 Agent 上报（任务反馈，不代表用户新增授权），来源：${JSON.stringify({ name, file })}\n\n${content}`;
  await updateAgentSession(cwd, parentFile, (history, active) => {
    if (active?.session) {
      // SDK 在工具结果后插入报告，避免破坏 assistant/toolResult 顺序。
      return active.session.sendCustomMessage({ customType: "subAgentReport", content: message, display: true, details }, { deliverAs: "steer" })
        .then(() => { active.send({ type: "report", ...details, content }); });
    }
    history.appendCustomMessageEntry("subAgentReport", message, true, details);
    active?.send({ type: "report", ...details, content });
  });
  return details.id;
}

// ACT: 回退/复制/删除都要重写或复制 JSONL 树，必须拒绝损坏行，不能沿用 SDK 会跳过坏行的读取器。
const sessionEntrySchema = z.object({ type: z.string(), id: z.string().min(1), parentId: z.string().nullable(), timestamp: z.string() });
const maxSessionFileBytes = 32 * 1024 * 1024;

async function readSessionEntriesStrict(path: string, action: string, enforceSize = true): Promise<FileEntry[]> {
  let entries: FileEntry[];
  try {
    const text = await readFile(path, "utf8");
    // ACT: 只有回退/复制限制体积；删除消息恰好是清理超大会话的入口，不受限制。
    if (enforceSize && Buffer.byteLength(text, "utf8") > maxSessionFileBytes) {
      throw Object.assign(new Error(`会话文件超过 32 MB，无法${action}`), { status: 413 });
    }
    entries = text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw Object.assign(new Error(`会话文件损坏，无法${action}`), { status: 400 });
  }
  if (entries[0]?.type !== "session") throw Object.assign(new Error("会话文件无效"), { status: 400 });
  const knownIds = new Set<string>();
  for (const entry of entries.slice(1)) {
    const parsed = sessionEntrySchema.safeParse(entry);
    if (!parsed.success || knownIds.has(parsed.data.id) || (parsed.data.parentId !== null && !knownIds.has(parsed.data.parentId))) {
      throw Object.assign(new Error(`会话记录结构无效，无法${action}`), { status: 400 });
    }
    knownIds.add(parsed.data.id);
  }
  return entries;
}

/**
 * 手动压缩当前会话。
 *
 * 方案取舍：SDK 只从公开入口导出了 compact()，prepareCompaction() 位于未公开的
 * dist/core/compaction 深路径，直接引用会绑定内部文件布局。这里按 SDK 官方手动压缩入口
 * 构造临时 AgentSession 调用 session.compact()：切点仍由 prepareCompaction 计算，
 * 鉴权、摘要、appendCompaction 落盘和事件顺序都走 SDK 正式路径，结束后立即 dispose。
 * 该会话不注册到 activeSessions，文件锁由本函数持有。
 */
export async function compactAgentSession(cwd: string, path: string, signal?: AbortSignal) {
  if (getActiveAgentSession(path)) throw Object.assign(new Error("对话正在运行，请先停止后再压缩"), { status: 409 });
  const release = getAgentHost().workspace.lockWorkspaceFiles([path]);
  try {
    // ACT: 需要压缩的恰恰是超大历史，这里不设 32 MB 上限；只拒绝损坏行与非法结构。
    const entries = await readSessionEntriesStrict(path, "压缩", false);
    // ACT: 在内存副本上压缩，成功且摘要非空才写回，失败时磁盘文件保持原样。
    // ACT: SDK 会直接把条目写进传入的数组，必须给副本，否则写回时会把新增条目再拼一次。
    const history = SessionManager.inMemory(cwd, undefined, [...entries]);
    // ACT: getEntries() 不含 header，用压缩前的实际条目数作基准，避免把 header 算进去导致取错新增项。
    const baseEntries = history.getEntries().length;
    const modelRef = history.buildSessionContext().model;
    // ACT: 旧会话或手工编辑的文件里 assistant 可能缺 provider/model，此时解构出空对象也要拒绝，不能拿 undefined 去查供应商。
    if (!modelRef?.provider || !modelRef.modelId) throw Object.assign(new Error("会话未记录模型，无法压缩"), { status: 400 });
    const { runtime } = await createAgentModel(modelRef.provider, modelRef.modelId);
    const model = runtime.getModel(modelRef.provider, modelRef.modelId);
    if (!model) throw Object.assign(new Error("会话使用的模型不可用，请重新选择后再压缩"), { status: 400 });
    const settings = createAgentSettings(model.contextWindow, { retry: true, maxOutputTokens: model.maxTokens });
    const resources = await createAgentResources(cwd, [], settings);
    const { session } = await createAgentSession({
      cwd,
      ...resources,
      modelRuntime: runtime,
      model,
      sessionManager: history,
      tools: [],
    });
    const abort = () => { try { session.abortCompaction(); } catch { /* 已结束 */ } };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await session.compact();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[agent.compact] failed:", message);
      const status = (error as { status?: number; cause?: { status?: number } }).status ?? (error as { cause?: { status?: number } }).cause?.status;
      // ACT: SDK 用这两句表示无需压缩；鉴权类错误（含供应商 401/403）归为客户端可修正的 400。
      if (/Nothing to compact|Already compacted/i.test(message)) {
        throw Object.assign(new Error("当前对话没有可压缩的内容"), { status: 400 });
      }
      if (status === 401 || status === 403 || /No API key found|Authentication failed|Unauthorized|Forbidden|invalid api key|No model selected/i.test(message)) {
        throw Object.assign(new Error("会话使用的模型不可用，请检查模型配置与密钥"), { status: 400 });
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      session.dispose();
    }
    // ACT: 只回写本次新增的 compaction 条目，临时会话可能顺带追加的配置记录一律丢弃。
    const appended = history.getEntries().slice(baseEntries).filter((entry) => entry.type === "compaction");
    if (!appended.length) throw Object.assign(new Error("当前对话没有可压缩的内容"), { status: 400 });
    if (appended.some((entry) => typeof entry.summary !== "string" || !entry.summary.trim())) {
      throw Object.assign(new Error("上下文压缩失败：模型返回了空摘要，已放弃本次压缩"), { status: 400 });
    }
    const known = new Set(entries.map((entry) => entry.id));
    if (appended.some((entry) => !known.has(entry.firstKeptEntryId))) {
      throw Object.assign(new Error("上下文压缩失败：摘要指向的历史不存在，已放弃本次压缩"), { status: 400 });
    }
    // ACT: 只写回 compaction，但临时会话可能先追加了思考等级等状态记录；这些记录不落盘，
    // 需要把 compaction 的父节点改挂到最后一个已存在的条目上，否则会留下悬空 parentId。
    const lastId = entries.at(-1)?.id ?? null;
    const toWrite = appended.map((entry) => (entry.parentId && known.has(entry.parentId) ? entry : { ...entry, parentId: lastId }));
    await getAgentHost().workspace.writeWorkspaceFile(path, [...entries, ...toWrite].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    // ACT: 压缩已经落盘；之后读取会话失败不应让接口报失败，避免前端以为没压缩而重复触发。
    return await getAgentSession(cwd, path).catch(() => ({
      file: basename(path), name: history.getSessionName() ?? "新对话", messages: [], stats: getAgentStats(history),
    }) as unknown as Awaited<ReturnType<typeof getAgentSession>>);
  } finally {
    release();
  }
}

const isUserEntry = (entry: SessionEntry) =>
  (entry.type === "message" && entry.message.role === "user") || (entry.type === "custom" && entry.customType === "toonflowDeletedUser");

function newEntryId(used: Set<string>) {
  for (let index = 0; index < 100; index++) {
    const id = crypto.randomUUID().slice(0, 8);
    if (!used.has(id)) return id;
  }
  return crypto.randomUUID();
}

export async function deleteAgentMessage(cwd: string, path: string, options: { entryIds?: string[]; replyTo?: string }) {
  if (Boolean(options.entryIds) === Boolean(options.replyTo)) {
    throw Object.assign(new Error("请选择要删除的消息"), { status: 400 });
  }
  const release = getAgentHost().workspace.lockWorkspaceFiles([path]);
  try {
    let entries = await readSessionEntriesStrict(path, "删除消息", false);
    // ACT: SDK 会直接把条目写进传入的数组，必须给副本，否则写回时会把新增条目再拼一次。
    const history = SessionManager.inMemory(cwd, undefined, [...entries]);
    const branch = history.getBranch();
    let targets = branch.filter((entry) => options.entryIds?.includes(entry.id));
    if (options.replyTo) {
      const index = branch.findIndex((entry) => entry.id === options.replyTo && isUserEntry(entry));
      if (index < 0) throw Object.assign(new Error("消息不在当前对话中，请重新打开对话"), { status: 400 });
      const nextUser = branch.findIndex((entry, position) => position > index && isUserEntry(entry));
      targets = branch
        .slice(index + 1, nextUser < 0 ? undefined : nextUser)
        .filter((entry) => entry.type === "message" && entry.message.role === "assistant");
    }
    if (
      options.entryIds &&
      (new Set(options.entryIds).size !== targets.length ||
        targets.some((entry) => entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")))
    ) {
      throw Object.assign(new Error("消息不在当前对话中，请重新打开对话"), { status: 400 });
    }
    if (!targets.length) return await getAgentSession(cwd, path);

    const removedIds = new Set(targets.map((entry) => entry.id));
    const toolCallIds = new Set(
      targets.flatMap((entry) =>
        entry.type === "message" && entry.message.role === "assistant"
          ? entry.message.content.filter((part) => part.type === "toolCall").map((part) => part.id)
          : []
      )
    );
    const affectedIds = new Set(removedIds);
    const timedTurns = new Map<string, boolean>();
    for (const entry of history.getEntries()) {
      if ((entry.parentId && affectedIds.has(entry.parentId)) || (entry.type === "branch_summary" && affectedIds.has(entry.fromId))) {
        affectedIds.add(entry.id);
      }
      const timingChanged = !isUserEntry(entry) && (removedIds.has(entry.id) || Boolean(entry.parentId && timedTurns.get(entry.parentId)));
      timedTurns.set(entry.id, timingChanged);
      if (
        (entry.type === "message" && entry.message.role === "toolResult" && toolCallIds.has(entry.message.toolCallId)) ||
        (entry.type === "custom" &&
          ["toonflowAttachments", "toonflowUserMessage"].includes(entry.customType) &&
          removedIds.has((entry.data as { messageId?: string } | undefined)?.messageId ?? "")) ||
        (entry.type === "custom" && entry.customType === "toonflowTiming" && timingChanged) ||
        ((entry.type === "compaction" || entry.type === "branch_summary") && affectedIds.has(entry.id)) ||
        (entry.type === "label" && removedIds.has(entry.targetId))
      ) {
        removedIds.add(entry.id);
      }
    }
    // ACT: 清除正文并保留树节点，避免分支、叶指针和实时回复的 user 锚点失效；摘要也不能带回已删内容。
    entries = [
      entries[0],
      ...history.getEntries().map((entry) =>
        removedIds.has(entry.id)
          ? {
              type: "custom" as const,
              id: entry.id,
              parentId: entry.parentId,
              timestamp: new Date().toISOString(),
              customType: isUserEntry(entry) ? "toonflowDeletedUser" : "toonflowDeletedEntry",
            }
          : entry
      ),
    ];
    await getAgentHost().workspace.writeWorkspaceFile(path, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    return await getAgentSession(cwd, path);
  } finally {
    release();
  }
}

/**
 * 收集回退要丢弃的条目：锚点整棵子树（跨分支级联）+ 引用被删内容的派生记录。
 * 返回的 id 集合一定是"后代闭包"，因此保留下来的条目 parentId 仍然有效。
 */
function collectRewindRemovals(history: SessionManager, anchor: SessionEntry) {
  const removed = new Set<string>([anchor.id]);
  const toolCalls = new Set<string>();
  for (const entry of history.getEntries()) {
    const removedByParent = Boolean(entry.parentId && removed.has(entry.parentId));
    const removedBySummary = entry.type === "branch_summary" && removed.has(entry.fromId);
    if (removedByParent || removedBySummary) {
      removed.add(entry.id);
    } else if (entry.type === "message" && entry.message.role === "toolResult" && toolCalls.has(entry.message.toolCallId)) {
      removed.add(entry.id);
    } else if (entry.type === "custom" && (entry.customType === "toonflowAttachments" || entry.customType === "toonflowUserMessage")
      && removed.has((entry.data as { messageId?: string } | undefined)?.messageId ?? "")) {
      removed.add(entry.id);
    } else if (entry.type === "label" && removed.has(entry.targetId)) {
      removed.add(entry.id);
    } else {
      continue;
    }
    if (entry.type === "message" && entry.message.role === "assistant") {
      for (const part of entry.message.content) if (part.type === "toolCall") toolCalls.add(part.id);
    }
  }
  return removed;
}

const sessionFileNamePattern = /^[\w-]+\.jsonl$/;

/** 条目里引用的子 Agent 会话文件（只接受合法文件名，避免把任意路径带进删除流程）。 */
function subAgentFilesOf(entries: SessionEntry[]) {
  const files = new Set<string>();
  for (const entry of entries) {
    const file = entry.type === "custom" && entry.customType === "toonflowSubAgent"
      ? (entry.data as { file?: unknown } | undefined)?.file
      : entry.type === "custom_message" && entry.customType === "subAgentReport"
        ? (entry.details as { file?: unknown } | undefined)?.file
        : undefined;
    if (typeof file === "string" && sessionFileNamePattern.test(file)) files.add(file);
  }
  return files;
}

function parseSessionLines(text: string) {
  const entries: SessionEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* 容忍坏行，仅用于读取子会话引用 */ }
  }
  return entries;
}

/** 子 Agent 会话可能单独开着；操作父会话前必须确认没有子会话在跑。 */
async function assertNoActiveSubAgents(cwd: string, entries: SessionEntry[]) {
  const { path: directory } = await getAgentHost().workspace.resolveWorkspacePath(cwd, ".agent/sessions", true);
  for (const file of subAgentFilesOf(entries)) {
    const target = await getAgentHost().workspace.resolveWorkspacePath(directory, file, true);
    if (getActiveAgentSession(target.path)) throw Object.assign(new Error("子 Agent 正在运行，请先停止后再操作"), { status: 409 });
  }
}

/**
 * 递归删除被回退掉的子 Agent 会话文件。
 * ACT: 只删 header.parentSession 指向本会话的文件，避免误删 fork 复制的共享子会话或其他会话文件；
 * 正在运行或已不存在的直接跳过，删除失败不阻断已提交的回退。
 */
async function removeSessionFiles(cwd: string, parentFile: string, files: Iterable<string>) {
  const { path: directory } = await getAgentHost().workspace.resolveWorkspacePath(cwd, ".agent/sessions", true);
  const visited = new Set<string>();
  const queue = [...files];
  while (queue.length) {
    const file = queue.shift()!;
    if (visited.has(file) || file === parentFile || !sessionFileNamePattern.test(file)) continue;
    visited.add(file);
    const target = await getAgentHost().workspace.resolveWorkspacePath(directory, file, true);
    if (getActiveAgentSession(target.path)) continue;
    const text = await readFile(target.path, "utf8").catch(() => undefined);
    if (text === undefined) continue;
    const entries = parseSessionLines(text);
    const header = entries[0] as { type?: string; parentSession?: unknown } | undefined;
    if (header?.type !== "session" || basename(String(header.parentSession ?? "")) !== parentFile) continue;
    for (const child of subAgentFilesOf(entries)) queue.push(child);
    await unlink(target.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") console.warn(`回退时删除子会话失败：${target.path}`, error);
    });
  }
}

/** 回退：以用户消息为界，物理删除该条及其后的全部内容，并让叶指针回到上一轮末尾。 */
export async function rewindAgentSession(cwd: string, path: string, entryId: string) {
  if (getActiveAgentSession(path)) throw Object.assign(new Error("对话正在运行，请先停止后再回退"), { status: 409 });
  const release = getAgentHost().workspace.lockWorkspaceFiles([path]);
  try {
    const entries = await readSessionEntriesStrict(path, "回退");
    // ACT: SDK 会直接把条目写进传入的数组，必须给副本，否则写回时会把新增条目再拼一次。
    const history = SessionManager.inMemory(cwd, undefined, [...entries]);
    if (history.getBranch().some((entry) => entry.type === "custom" && entry.customType === "toonflowSubAgentInfo")) {
      throw Object.assign(new Error("子 Agent 会话不支持回退"), { status: 400 });
    }
    // 锚点必须是真实用户消息：墓碑用户界面上不可选，也不该成为回退起点。
    const anchor = history.getBranch().find((entry) =>
      entry.id === entryId && entry.type === "message" && entry.message.role === "user");
    if (!anchor) throw Object.assign(new Error("消息不在当前对话中，请重新打开对话"), { status: 400 });
    await assertNoActiveSubAgents(cwd, entries.slice(1) as SessionEntry[]);
    const removed = collectRewindRemovals(history, anchor);
    const body = entries.slice(1) as SessionEntry[];
    const kept = body.filter((entry) => !removed.has(entry.id));
    const keptIds = new Set(kept.map((entry) => entry.id));
    // ACT: 压缩记录指向被删条目会让上下文静默丢掉整段历史，宁可丢弃该记录重新压缩。
    const next = kept.filter((entry) =>
      (entry.type !== "compaction" || keptIds.has(entry.firstKeptEntryId))
      && (entry.type !== "branch_summary" || keptIds.has(entry.fromId)));
    const nextIds = new Set(next.map((entry) => entry.id));
    // ACT: 被丢弃的 compaction 可能正是保留条目的父级，丢弃后要重接到最近的存活祖先，否则整段历史会断链。
    const byId = new Map(body.map((entry) => [entry.id, entry]));
    const nearestSurviving = (id: string | null) => {
      let current = id;
      for (let guard = 0; current && !nextIds.has(current) && guard < body.length; guard++) current = byId.get(current)?.parentId ?? null;
      return current && nextIds.has(current) ? current : null;
    };
    for (const entry of next) if (entry.parentId && !nextIds.has(entry.parentId)) entry.parentId = nearestSurviving(entry.parentId);
    const subAgentFiles = subAgentFilesOf(body.filter((entry) => removed.has(entry.id)));
    for (const file of subAgentFilesOf(next)) subAgentFiles.delete(file);
    // ACT: 叶指针不落盘，SDK 以文件最后一行作为当前分支末尾；显式追加空标记把叶固定回锚点父级。
    const used = new Set(nextIds);
    next.push({
      type: "custom", id: newEntryId(used), parentId: nearestSurviving(anchor.parentId), timestamp: new Date().toISOString(),
      customType: "toonflowRewind", data: { from: anchor.id },
    } as SessionEntry);
    await getAgentHost().workspace.writeWorkspaceFile(path, [entries[0], ...next].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    // 回退已经落盘，子会话清理失败不应把成功的回退报成失败。
    await removeSessionFiles(cwd, basename(path), subAgentFiles).catch((error) => console.warn("回退后清理子会话失败", error));
    return await getAgentSession(cwd, path);
  } finally {
    release();
  }
}

/**
 * 递归复制子 Agent 会话文件：新 header 指向新父会话，条目里的文件引用改写到副本。
 * 返回 源文件名 → 新文件名 的映射。
 */
async function cloneSubAgentFiles(cwd: string, directory: string, parentFile: string, files: Iterable<string>, renamed: Map<string, string>) {
  for (const file of files) {
    if (renamed.has(file) || !sessionFileNamePattern.test(file)) continue;
    const source = await getAgentHost().workspace.resolveWorkspacePath(directory, file, true);
    const entries = await readSessionEntriesStrict(source.path, "复制会话").catch(() => undefined);
    if (!entries) continue;
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const fileName = `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`;
    renamed.set(file, fileName);
    const header = { type: "session", version: (entries[0] as { version?: number }).version ?? 3, id, timestamp, cwd, parentSession: parentFile };
    const body = entries.slice(1) as SessionEntry[];
    await cloneSubAgentFiles(cwd, directory, fileName, subAgentFilesOf(body), renamed);
    for (const entry of body) rewriteSubAgentRefs(entry, parentFile, renamed);
    const target = await getAgentHost().workspace.resolveWorkspacePath(directory, fileName, true);
    await getAgentHost().workspace.writeWorkspaceFile(target.path, [header, ...body].map((entry) => JSON.stringify(entry)).join("\n") + "\n", true);
  }
}

/** 把条目里指向源会话的子 Agent 文件/父文件改写为副本，避免 fork 的会话污染源会话。 */
function rewriteSubAgentRefs(entry: SessionEntry, parentFile: string, renamed: Map<string, string>) {
  const rewrite = (target: Record<string, unknown> | undefined) => {
    if (!target) return;
    if (typeof target.parentFile === "string") target.parentFile = parentFile;
    if (typeof target.file === "string" && renamed.has(target.file)) target.file = renamed.get(target.file);
  };
  if (entry.type === "custom" && entry.customType === "toonflowSubAgent") rewrite(entry.data as Record<string, unknown>);
  if (entry.type === "custom_message" && entry.customType === "subAgentReport") rewrite(entry.details as Record<string, unknown> | undefined);
}

/** 复制为新会话：截取当前分支到该条消息所在轮结束，写新文件并返回。 */
export async function forkAgentSession(cwd: string, path: string, entryId: string) {
  if (getActiveAgentSession(path)) throw Object.assign(new Error("对话正在运行，请先停止后再复制"), { status: 409 });
  const release = getAgentHost().workspace.lockWorkspaceFiles([path]);
  try {
    const entries = await readSessionEntriesStrict(path, "复制会话");
    // ACT: SDK 会直接把条目写进传入的数组，必须给副本，否则写回时会把新增条目再拼一次。
    const history = SessionManager.inMemory(cwd, undefined, [...entries]);
    if (history.getBranch().some((entry) => entry.type === "custom" && entry.customType === "toonflowSubAgentInfo")) {
      throw Object.assign(new Error("子 Agent 会话不支持复制"), { status: 400 });
    }
    await assertNoActiveSubAgents(cwd, entries.slice(1) as SessionEntry[]);
    const branch = history.getBranch();
    // 锚点可以是用户消息（右侧）或 agent 回复（左侧），都以所在轮的结尾为截止点。
    const start = branch.findIndex((entry) => entry.id === entryId
      && ((entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant"))
        || (entry.type === "custom" && entry.customType === "toonflowDeletedUser")));
    if (start < 0) throw Object.assign(new Error("消息不在当前对话中，请重新打开对话"), { status: 400 });
    // 本轮结束于下一条用户消息之前；没有下一轮则到分支末尾。
    const nextUser = branch.findIndex((entry, index) => index > start && isUserEntry(entry));
    const copied = branch.slice(0, nextUser < 0 ? undefined : nextUser) as SessionEntry[];
    const { path: directory } = await getAgentHost().workspace.resolveWorkspacePath(cwd, ".agent/sessions", true);
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const fileName = `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`;
    // ACT: 子 Agent 会话必须深拷贝并改指向，否则副本里的上报会写回源会话，回退副本还可能删掉源子会话。
    const renamed = new Map<string, string>();
    await cloneSubAgentFiles(cwd, directory, fileName, subAgentFilesOf(copied), renamed);
    for (const entry of copied) rewriteSubAgentRefs(entry, fileName, renamed);
    const header = { type: "session", version: (entries[0] as { version?: number }).version ?? 3, id, timestamp, cwd };
    // ACT: 普通纯文本会话没有 session_info，名称取展示名兜底；反复复制不应叠加「副本」后缀。
    const sourceName = (await getAgentSession(cwd, path)).name || "新对话";
    const name = `${sourceName.replace(/(?: · 副本(?:\s\d+)?)+$/u, "").slice(0, 72)} · 副本`;
    const used = new Set(copied.map((entry) => entry.id));
    const sessionInfo = { type: "session_info", id: newEntryId(used), parentId: copied.at(-1)?.id ?? null, timestamp, name };
    const target = await getAgentHost().workspace.resolveWorkspacePath(directory, fileName, true);
    await getAgentHost().workspace.writeWorkspaceFile(target.path, [header, ...copied, sessionInfo].map((entry) => JSON.stringify(entry)).join("\n") + "\n", true);
    return { file: basename(target.path), name, conversation: await getAgentSession(cwd, target.path) };
  } finally {
    release();
  }
}

export async function createAgentConversation(cwd: string, child?: Omit<AgentSubAgent, "file" | "status">) {
  const { path: directory } = await getAgentHost().workspace.resolveWorkspacePath(cwd, ".agent/sessions", true);
  const history = SessionManager.create(cwd, directory, child ? { parentSession: child.parentFile } : undefined);
  const path = history.getSessionFile()!;
  history.appendCustomEntry("toonflowReasoning", { thinkingLevel: child?.thinkingLevel ?? null });
  if (child) {
    history.appendSessionInfo(child.name);
    history.appendCustomEntry("toonflowSubAgentInfo", { ...child, file: basename(path), status: "running" });
    if (child.providerId && child.modelId) history.appendModelChange(child.providerId, child.modelId);
    if (child.thinkingLevel) history.appendThinkingLevelChange(child.thinkingLevel);
  }
  // ACT: SDK 默认等首条回复才落盘；先保存会话头，让空对话也能被历史列表读取。
  await getAgentHost().workspace.writeWorkspaceFile(path, [history.getHeader(), ...history.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n", true);
  return getAgentSession(cwd, path);
}

export async function renameAgentSession(cwd: string, path: string, name: string) {
  const release = getAgentHost().workspace.lockWorkspaceFiles([path]);
  try {
    const entries = parseSessionEntries(await readFile(path, "utf8"));
    if (entries[0]?.type !== "session") throw Object.assign(new Error("会话文件无效"), { status: 400 });
    const history = SessionManager.open(path, dirname(path), cwd);
    history.appendSessionInfo(name);
    return { name: history.getSessionName()! };
  } finally {
    release();
  }
}

const agentNodeMarkerType = "toonflowAgentNode";
// ACT: 只认自定义条目的字段形状，普通对话正文里恰好出现这个词不会被误判成节点会话。
const agentNodeMarkerToken = `"customType":"${agentNodeMarkerType}"`;
const agentNodeScanBytes = 8 * 1024;

/** 节点会话标记：payload 固定为 { canvasId, nodeId, timestamp }，同一会话只写一次。 */
export function appendAgentNodeMarker(history: SessionManager, binding: AgentNodeBinding) {
  const exists = history.getEntries().some((entry) => entry.type === "custom" && entry.customType === agentNodeMarkerType);
  if (exists) return false;
  history.appendCustomEntry(agentNodeMarkerType, { ...binding, timestamp: new Date().toISOString() });
  return true;
}

/** 只读前 8 KB 判断标记；读失败按普通会话处理，宁可多显示也不误藏用户历史。 */
async function hasAgentNodeMarkerOnDisk(path: string) {
  try {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(agentNodeScanBytes);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead).includes(agentNodeMarkerToken);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

/** 会话展示名：优先最新 session_info，其次首条用户消息，与 getAgentSession 的兜底口径一致。 */
function sessionDisplayName(entries: SessionEntry[]) {
  const named = entries.findLast((entry) => entry.type === "session_info" && Boolean(entry.name?.trim()));
  if (named?.type === "session_info") return named.name!.trim();
  const firstUser = entries.find(
    (entry): entry is Extract<SessionEntry, { type: "message" }> => entry.type === "message" && entry.message.role === "user"
  );
  if (!firstUser || firstUser.message.role !== "user") return undefined;
  const content = firstUser.message.content;
  const text = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("");
  return text.trim().slice(0, 60) || undefined;
}

function cloneSessionName(sourceName: string) {
  // ACT: 与 fork 一致，反复克隆不叠加「副本」后缀。
  return `${sourceName.replace(/(?: · 副本(?:\s\d+)?)+$/u, "").slice(0, 72)} · 副本`;
}

/**
 * 复制会话到同目录的新文件，再在副本末尾追加 session_info。
 * 未运行：逐字节复制源文件（源只读，副本天然保留 toonflowAgentNode 标记）；
 * 运行中：改用内存条目快照，只复制到本轮开始前，副本停在上一条完整回复。
 */
export async function cloneAgentSession(cwd: string, path: string) {
  if (!sessionFileNamePattern.test(basename(path))) throw Object.assign(new Error("会话标识无效"), { status: 400 });
  const known = getActiveAgentSession(path);
  const source = await stat(path).catch((error: NodeJS.ErrnoException) => {
    // ACT: 运行中的会话可能还没落盘（SDK 首条助手消息才写文件），有内存条目可克隆时不必报 404。
    if (error.code === "ENOENT" && known) return undefined;
    if (error.code === "ENOENT") throw Object.assign(new Error("会话不存在，请重新打开对话"), { status: 404 });
    throw error;
  });
  if (source && !source.isFile()) throw Object.assign(new Error("会话必须是普通文件"), { status: 400 });
  // ACT: stat 期间本轮可能刚好结束并注销；重新取一次，文件不存在时仍用刚结束的内存会话兜底。
  const active = getActiveAgentSession(path) ?? (source ? undefined : known);
  let bytes: Buffer;
  let name: string;
  if (active) {
    // ACT: 不读盘：内存条目一定是完整条目，也不受并发追加影响。
    const entries = active.history.getEntries();
    const header = active.history.getHeader();
    if (!header) throw Object.assign(new Error("会话文件无效"), { status: 400 });
    // ACT: 回复已结束、只是 run 还没注销时（自动压缩、计时统计等收尾），本轮已经完整，整段保留；
    // 只有真正在跑的时候才截到本轮开始前，进行中这一轮（含刚发出的用户消息）不进入副本。
    const cut = active.session?.isIdle ? entries.length : active.entryOffset;
    const snapshot = snapshotSessionEntries(entries, cut);
    // ACT: 条目对象与 SDK 共享引用，切片和序列化必须在同一个同步块内完成，避免序列化到被中途改写的条目。
    bytes = Buffer.from([header, ...snapshot].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    // ACT: 名字用全量条目算：首轮的用户消息就在截断点之后，用快照算会退化成「新对话」。
    name = cloneSessionName(sessionDisplayName(entries) ?? "新对话");
  } else {
    const content = await readFile(path);
    // ACT: 极少数旧文件可能没有结尾换行，补一个换行避免 session_info 与最后一行粘连。
    bytes = content.length && content.at(-1) !== 0x0a ? Buffer.concat([content, Buffer.from("\n")]) : content;
    name = cloneSessionName(sessionDisplayName(parseSessionLines(content.toString("utf8"))) ?? "新对话");
  }
  const { path: directory } = await getAgentHost().workspace.resolveWorkspacePath(cwd, ".agent/sessions", true);
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const fileName = `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`;
  const target = await getAgentHost().workspace.resolveWorkspacePath(directory, fileName, true);
  await getAgentHost().workspace.writeWorkspaceFile(target.path, bytes, true);
  try {
    await renameAgentSession(cwd, target.path, name);
  } catch (error) {
    await unlink(target.path).catch(() => { /* 清理失败不覆盖原始错误 */ });
    throw error;
  }
  return { file: basename(target.path), name };
}

/** 删除会话文件；运行中的会话必须先停止，文件不存在视为已删除。 */
export async function removeAgentSession(cwd: string, path: string) {
  if (!sessionFileNamePattern.test(basename(path))) throw Object.assign(new Error("会话标识无效"), { status: 400 });
  if (getActiveAgentSession(path)) throw Object.assign(new Error("会话正在运行，请先停止"), { status: 409 });
  // ACT: 节点会话可能派发过子会话，只删父文件会把子会话永久留在盘上；沿用回退时的递归清理。
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text !== undefined) await removeSessionFiles(cwd, basename(path), subAgentFilesOf(parseSessionLines(text)));
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function listAgentSessions(cwd: string, directory: string, options: { includeAgentNodes?: boolean } = {}) {
  const files = new Set((await readdir(directory, { withFileTypes: true })).filter((item) => item.isFile()).map((item) => item.name));
  const sessions = await SessionManager.list(cwd, directory);
  const visible = [];
  for (const item of sessions) {
    if (!files.has(basename(item.path)) || item.parentSessionPath) continue;
    // ACT: 节点会话默认不进历史；仅显式 opt-in（如调试/管理）时列出。
    if (!options.includeAgentNodes && await hasAgentNodeMarkerOnDisk(item.path)) continue;
    visible.push(item);
  }
  return visible
    .sort((left, right) => right.modified.getTime() - left.modified.getTime())
    .map((item) => ({
      file: basename(item.path),
      name: item.name || (item.messageCount ? item.firstMessage.trim().slice(0, 60) : "") || "新对话",
      modified: item.modified,
      messageCount: item.messageCount,
    }));
}

export async function getAgentSession(cwd: string, path: string) {
  const active = getActiveAgentSession(path);
  const entries = active
    ? [active.history.getHeader()!, ...active.history.getEntries()]
    : parseSessionEntries(await readFile(path, "utf8"));
  if (entries[0]?.type !== "session") throw Object.assign(new Error("会话文件无效"), { status: 400 });
  const partial = active?.session?.agent.state.streamingMessage;
  if (partial?.role === "assistant") entries.push({
    type: "message", id: "streaming", parentId: active!.history.getLeafId(), timestamp: new Date().toISOString(), message: partial,
  });
  const messageIndices = new Map(active ? entries.slice(active.entryOffset + 1)
    .filter(entry => entry.type === "message" && entry.message.role === "assistant")
    .map((entry, index) => [(entry as SessionEntry).id, index + 1]) : []);
  const history = SessionManager.inMemory(cwd, undefined, entries);
  const branch = history.getBranch();
  const reasoning = branch.findLast(entry => entry.type === "custom" && entry.customType === "toonflowReasoning");
  const reasoningSelection = z.object({ thinkingLevel: z.enum(thinkingLevels).nullable() }).safeParse(reasoning?.type === "custom" ? reasoning.data : undefined);
  const attachmentMessages = new Map(
    branch.flatMap((entry) => {
      if (entry.type !== "custom" || !["toonflowAttachments", "toonflowUserMessage"].includes(entry.customType)) return [];
      const parsed = z.object({ messageId: z.string(), content: z.string(), attachments: agentAttachmentsSchema, mentions: agentMentionsSchema.optional() }).safeParse(entry.data);
      return parsed.success ? [[parsed.data.messageId, parsed.data] as const] : [];
    })
  );
  const toolResults = new Map(
    branch.flatMap((entry) =>
      entry.type === "message" && entry.message.role === "toolResult" ? [[entry.message.toolCallId, entry.message] as const] : []
    )
  );
  let replyTo: string | undefined;
  const entriesMessages = branch.flatMap<SessionMessage>((entry) => {
    if (entry.type === "custom" && entry.customType === "toonflowDeletedUser") replyTo = entry.id;
    if (entry.type === "custom_message" && entry.customType === "subAgentReport") {
      const details = entry.details as { id?: string; file: string; name: string; content?: string };
      const content = details.content ?? (typeof entry.content === "string" ? entry.content : getToolResultText(entry.content));
      return [{
        id: details.id ?? entry.id, entryId: entry.id, replyTo: undefined, role: "assistant" as const,
        content, parts: [{ id: details.id ?? entry.id, type: "text", content }], error: undefined,
        attachments: undefined, report: { file: details.file, name: details.name },
      }];
    }
    if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) return [];
    const message = entry.message;
    if (message.role === "user") replyTo = entry.id;
    const attachmentMessage = message.role === "user" ? attachmentMessages.get(entry.id) : undefined;
    const attachments = attachmentMessage?.attachments;
    const parts =
      message.role === "assistant"
        ? message.content
            .map((part, index) => {
              const id = `${messageIndices.get(entry.id) ?? entry.id}:${index}`;
              if (part.type === "text") return { id, type: "text" as const, content: part.text };
              if (part.type === "thinking") return { id, type: "thinking" as const, content: part.thinking, collapsed: true };
              if (part.type === "toolCall") {
                const result = toolResults.get(part.id);
                return {
                  id,
                  type: "tool" as const,
                  tool: active?.tools.get(part.id) ?? {
                    id: part.id,
                    name: part.name,
                    args: part.arguments,
                    status: result ? (result.isError ? "error" as const : "success" as const) : "interrupted" as const,
                    result: result ? getToolResultText(result.content) : undefined,
                  },
                };
              }
            })
            .filter((part) => part !== undefined)
        : [];
    const content =
      message.role === "assistant"
        ? ""
        : attachmentMessage?.content ??
          (typeof message.content === "string"
            ? message.content
            : message.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""));
    const error = message.role === "assistant" ? message.errorMessage : undefined;
    return [
      {
        id: entry.id,
        entryId: entry.id,
        replyTo: message.role === "assistant" ? replyTo : undefined,
        role: message.role,
        content,
        parts,
        error,
        attachments,
        mentions: attachmentMessage?.mentions,
        report: undefined,
      },
    ];
  });
  const groupedMessages: typeof entriesMessages = [];
  for (const message of entriesMessages) {
    const previous = groupedMessages.at(-1);
    if (message.role === "assistant" && message.replyTo && previous?.role === "assistant" && previous.replyTo === message.replyTo) {
      previous.parts.push(...message.parts);
      previous.error = message.error;
    } else groupedMessages.push(message);
  }
  // ACT: 同轮的工具调用与多步回复合并后，只拼接一次正文。
  for (const message of groupedMessages) {
    if (message.role === "assistant" && !message.report) message.content = message.parts.flatMap(part => part.type === "text" ? [part.content] : []).join("\n\n");
  }
  const latestUser = groupedMessages.findLast(message => message.role === "user");
  const activeReply = active && latestUser ? groupedMessages.findLast(message =>
    message.role === "assistant" && !message.report && message.replyTo === latestUser.id && messageIndices.has(message.entryId)
  ) : undefined;
  if (activeReply) activeReply.streaming = true;
  const messages = groupedMessages.filter((message) => message.content || message.parts.length || message.error || message.attachments?.length || message.mentions?.length);
  const firstUserMessage = messages.find((item) => item.role === "user");
  const context = history.buildSessionContext();
  const lastReply = history.getBranch().findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
  const model =
    lastReply?.type === "message" && lastReply.message.role === "assistant"
      ? { provider: lastReply.message.provider, modelId: lastReply.message.model }
      : context.model;
  const providers = getAgentHost().settings.get("settings", {}).customProviders;
  const provider = getAgentHost().models.providerSchema.safeParse(Array.isArray(providers) ? providers.find((item) => item?.id === model?.provider) : undefined);
  const configuredModel = provider.success ? provider.data.models.find((item) => item.id === model?.modelId) : undefined;
  const subAgents = new Map<string, AgentSubAgent>();
  for (const entry of history.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== "toonflowSubAgent") continue;
    const agent = entry.data as AgentSubAgent;
    const interrupted = agent.status === "running" && !active && !getActiveAgentSession(resolve(dirname(path), agent.file));
    subAgents.set(agent.file, interrupted ? { ...agent, status: "cancelled", result: "上次运行已中断" } : agent);
  }
  return {
    file: basename(path),
    name: history.getSessionName() || (firstUserMessage?.content.trim() || firstUserMessage?.attachments?.[0]?.name)?.slice(0, 60) || "新对话",
    messages,
    stats: getAgentStats(history),
    contextUsage: getAgentContext(history, active?.session?.model?.contextWindow ?? (configuredModel && model ? getAgentHost().models.getModelLimits(model.provider, configuredModel).contextWindow : 0)),
    providerId: model?.provider,
    modelId: model?.modelId,
    thinkingLevel: reasoningSelection.success ? reasoningSelection.data.thinkingLevel ?? undefined : context.thinkingLevel,
    parentFile: getParentSessionFile(history),
    subAgents: [...subAgents.values()],
    running: Boolean(active),
  };
}

export function getToolResultText(content: { type: string; text?: string }[]) {
  return content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n");
}

export function getAgentStats(history: SessionManager, timing?: { outputTokens: number; decodeMs: number }) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  let outputTokens = timing?.outputTokens ?? 0;
  let decodeMs = timing?.decodeMs ?? 0;
  for (const entry of history.getBranch()) {
    const usage =
      entry.type === "compaction" || entry.type === "branch_summary"
        ? entry.usage
        : entry.type === "message" && (entry.message.role === "assistant" || entry.message.role === "toolResult")
        ? entry.message.usage
        : undefined;
    if (usage) {
      tokens.input += usage.input;
      tokens.output += usage.output;
      tokens.cacheRead += usage.cacheRead;
      tokens.cacheWrite += usage.cacheWrite;
    }
    if (entry.type === "custom" && entry.customType === "toonflowTiming") {
      const timing = entry.data as { outputTokens?: number; decodeMs?: number } | undefined;
      if (
        typeof timing?.outputTokens === "number" &&
        Number.isFinite(timing.outputTokens) &&
        timing.outputTokens > 0 &&
        typeof timing.decodeMs === "number" &&
        Number.isFinite(timing.decodeMs) &&
        timing.decodeMs > 0
      ) {
        outputTokens += timing.outputTokens;
        decodeMs += timing.decodeMs;
      }
    }
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  return { tokens, tokensPerSecond: decodeMs > 0 ? (outputTokens * 1000) / decodeMs : undefined };
}

export function getAgentContext(history: SessionManager, contextWindow = 0) {
  if (contextWindow <= 0) return undefined;
  const branch = history.getBranch();
  const compactionIndex = branch.findLastIndex((entry) => entry.type === "compaction");
  const recent = branch.slice(compactionIndex + 1);
  const usage = getLastAssistantUsage(recent);
  const messages = history.buildSessionContext().messages;
  const usageIndex = messages.findLastIndex((message) => message.role === "assistant" && message.usage === usage);
  const deletedAfterReply = branch.some(
    (entry) =>
      entry.type === "custom" &&
      (entry.customType === "toonflowDeletedUser" || entry.customType === "toonflowDeletedEntry") &&
      Date.parse(entry.timestamp) >= (messages[usageIndex]?.timestamp ?? 0)
  );
  // ACT: 压缩后先按摘要与保留消息估算，首条新回复后再使用模型 usage。
  const tokens =
    usage && usageIndex >= 0 && !deletedAfterReply
      ? calculateContextTokens(usage) + messages.slice(usageIndex + 1).reduce((total, message) => total + estimateTokens(message), 0)
      : messages.reduce((total, message) => total + estimateTokens(message), 0);
  return { tokens, contextWindow, percent: (tokens / contextWindow) * 100 };
}
