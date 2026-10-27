import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { mkdir, realpath, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import { agentArtifactsDirectory, getAgentPreferences } from "@/agent/runtime/preferences";
import { getAgentHost } from "@/agent/host";

type ToolContent = TextContent | ImageContent;

/** 工具名只用于文件名，统一收敛到 [\w.-]，避免路径分隔符或控制字符。 */
function safeToolName(toolName: string) {
  const safe = toolName.replace(/[^\w.-]/g, "_").slice(0, 64);
  return safe || "tool";
}

/**
 * 按 UTF-8 字节截断，并且只保留完整字符。
 * 从截断点回退到多字节序列的起始字节，避免把中文/emoji 切成替换字符。
 */
function utf8Prefix(text: string, maxBytes: number, bytes = Buffer.from(text, "utf8")) {
  if (bytes.byteLength <= maxBytes) return text;
  let end = Math.max(0, Math.min(maxBytes, bytes.byteLength));
  while (end > 0 && end < bytes.byteLength && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

function displayPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

async function offloadText(cwd: string, toolName: string, text: string, maxBytes: number, previewBytes: number, signal?: AbortSignal) {
  const bytes = Buffer.from(text, "utf8");
  const sizeKb = Math.max(1, Math.ceil(bytes.byteLength / 1024));
  const preview = utf8Prefix(text, previewBytes, bytes);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const relativePath = `${agentArtifactsDirectory}/${hash}-${safeToolName(toolName)}.txt`;
  try {
    signal?.throwIfAborted();
    // ACT: 与图片附件一致，先按真实工作区解析，禁止落盘路径逃逸出工作区。
    const root = await realpath(cwd);
    const target = await getAgentHost().workspace.resolveWorkspacePath(root, relativePath, true);
    const directory = await getAgentHost().workspace.resolveWorkspacePath(root, agentArtifactsDirectory, true);
    await mkdir(directory.path, { recursive: true });
    signal?.throwIfAborted();
    // ACT: 文件名由「内容哈希 + 工具名」决定，相同输出重复落盘时覆盖同一文件，保持幂等。
    await writeAtomic(target.path, bytes);
    return `[输出过大（约 ${sizeKb} KB），已保存到 ${displayPath(root, target.path)}]\n${preview}\n[以下省略；用 read 工具读取完整内容]`;
  } catch (error) {
    if (signal?.aborted) throw error;
    // ACT: 落盘失败不能反过来让工具调用失败，降级为截断 + 提示。
    console.warn(`工具输出落盘失败：${relativePath}`, error);
    const fallbackBytes = Math.min(maxBytes, previewBytes);
    return `[输出过大（约 ${sizeKb} KB），保存失败，仅保留前 ${fallbackBytes} 字节]\n${utf8Prefix(text, fallbackBytes, bytes)}\n[以下省略；请缩小输出范围后重试]`;
  }
}

/**
 * 对工具结果中的纯文本做「大输出落盘 + 指针」。
 * 阈值按整条结果的文本总字节判断（多个小文本块合起来超限同样落盘），图片等非文本内容原样保留。
 * skip=true 用于读取 artifacts 的情况：否则「读回来 → 再落盘」会把内容锁在预览里。
 */
export async function offloadToolContent(
  cwd: string, toolName: string, content: readonly ToolContent[], signal?: AbortSignal, options: { skip?: boolean } = {},
): Promise<ToolContent[]> {
  const { toolOutputMaxBytes, toolOutputPreviewBytes } = getAgentPreferences();
  const texts = content.filter((part): part is TextContent => part.type === "text");
  const totalBytes = texts.reduce((total, part) => total + Buffer.byteLength(part.text, "utf8"), 0);
  if (options.skip || !texts.length || totalBytes <= toolOutputMaxBytes) return [...content];
  const merged = texts.map((part) => part.text).join("\n\n");
  const pointer = await offloadText(cwd, toolName, merged, toolOutputMaxBytes, toolOutputPreviewBytes, signal);
  // 多个文本块合并成一个指针，放在第一个文本块的位置；非文本块保持原顺序。
  let placed = false;
  const result: ToolContent[] = [];
  for (const part of content) {
    if (part.type !== "text") { result.push(part); continue; }
    if (placed) continue;
    placed = true;
    result.push({ type: "text", text: pointer });
  }
  return result;
}
