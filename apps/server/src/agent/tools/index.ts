import { getAgentHost } from "@/agent/host";
import { basename, dirname, join, relative, resolve } from "node:path";
import { access, constants, copyFile, lstat, mkdir, readFile, readdir, rm, rmdir, stat, withFileAccess } from "@toonflow/file";
import {
  defineTool, createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
  detectSupportedImageMimeTypeFromFile, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { CanvasContext, QuestionContext, ToolContext, ToolFiles } from "@toonflow/tools-scaffold/runtime";
import { asrRequestSchema } from "@toonflow/tools-scaffold/runtime";
import { createSkillContext } from "@/agent/skills";
import { createAssetContext } from "@/agent/assets";
import { z } from "zod";
import { isAgentFullAccess, resolveAgentReadPath } from "@/agent/runtime/permissions";

const RUN_COMMAND_DEFAULT_TIMEOUT_MS = 120_000;
const RUN_COMMAND_MAX_TIMEOUT_MS = 600_000;
const RUN_COMMAND_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const RUN_COMMAND_MAX_CONCURRENCY = 4;

const runCommandSchema = z.object({
  command: z.string().trim().min(1).max(32768).describe("要执行的 bash 命令，工作目录固定为项目根目录"),
  timeoutMs: z.number().int().min(1000).max(RUN_COMMAND_MAX_TIMEOUT_MS).optional().describe("超时时间（毫秒），默认 120000，最大 600000"),
}).strict();

let runningCommands = 0;
const waitingCommands: Array<() => void> = [];

async function acquireCommandSlot(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("操作已取消");
  if (runningCommands < RUN_COMMAND_MAX_CONCURRENCY) {
    runningCommands++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let onAbort: (() => void) | undefined;
    const grant = () => {
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    onAbort = () => {
      const index = waitingCommands.indexOf(grant);
      if (index >= 0) waitingCommands.splice(index, 1);
      reject(new Error("操作已取消"));
    };
    waitingCommands.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function releaseCommandSlot() {
  const next = waitingCommands.shift();
  // ACT: 队列非空时直接把名额转交给下一个等待者，避免先减后加造成超卖。
  if (next) next();
  else runningCommands--;
}

type CommandOutput = { text: string; bytes: number; truncated: boolean };

async function collectCommandStream(stream: ReadableStream<Uint8Array>, output: CommandOutput) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remaining = RUN_COMMAND_MAX_OUTPUT_BYTES - output.bytes;
      if (remaining <= 0) {
        output.truncated = true;
        continue;
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      output.text += decoder.decode(chunk, { stream: true });
      output.bytes += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) output.truncated = true;
    }
    output.text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

// ACT: 不把服务端环境变量整体交给命令，至少剔除密钥类变量与 shell 启动脚本钩子。
function commandEnv() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/key|token|secret|password|credential|auth/i.test(key)) continue;
    if (key === "BASH_ENV" || key === "ENV" || key === "PROMPT_COMMAND") continue;
    env[key] = value;
  }
  return env;
}

async function runProjectCommand(cwd: string, command: string, timeoutMs: number, signal?: AbortSignal) {
  await acquireCommandSlot(signal);
  try {
    signal?.throwIfAborted();
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    let timedOut = false;
    let aborted = false;
    const stop = () => child?.kill("SIGKILL");
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      // ACT: --noprofile/--norc 避免用户 profile 里的 cd、别名、启动脚本改变实际行为。
      child = Bun.spawn(["bash", "--noprofile", "--norc", "-c", command], {
        cwd,
        env: commandEnv(),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const output: CommandOutput = { text: "", bytes: 0, truncated: false };
      const streams = Promise.all([collectCommandStream(child.stdout, output), collectCommandStream(child.stderr, output)]);
      // ACT: 子进程可能把管道留给孙进程；退出后给读取 2 秒宽限，超时直接放弃读取，避免工具调用永久挂起。
      const [exitCode] = await Promise.all([
        child.exited,
        Promise.race([streams, new Promise<void>((resolve) => setTimeout(resolve, 2000))]),
      ]);
      const notes = [`退出码：${exitCode}`];
      if (timedOut) notes.push(`执行超时（${timeoutMs} ms），已终止`);
      if (aborted) notes.push("操作已取消，已终止");
      if (output.truncated) notes.push("输出超过 8 MB，已截断");
      // 截断可能切在多字节字符中间，去掉尾部替换符。
      output.text = output.text.replace(/\uFFFD+$/u, "");
      return `${notes.join("\n")}\n\n${output.text || "(无输出)"}`;
    } catch (error) {
      // ACT: spawn 失败等执行错误作为工具结果返回，避免一次命令失败中断整轮工具调用。
      child?.kill("SIGKILL");
      const message = error instanceof Error ? error.message : String(error);
      return `命令执行失败：${message}`;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    releaseCommandSlot();
  }
}

function createRunCommandTool(cwd: string): ToolDefinition {
  return {
    name: "runCommand",
    label: "执行命令",
    description: "在项目根目录内通过 bash -lc 执行 shell 命令。这是高危能力：可以运行任意程序、修改或删除项目文件、访问网络，仅在用户明确要求时使用。cwd 固定为项目根目录；stdout 与 stderr 合并返回，单次输出最多 8 MB，超出会截断。非零退出码会作为结果返回，不会让工具调用失败。",
    promptSnippet: "在项目根目录执行 shell 命令（高危能力，仅在开放 Agent 全部权限时可用）。",
    parameters: z.toJSONSchema(runCommandSchema, { io: "input", target: "draft-07" }),
    async execute(_toolCallId, params, signal) {
      // ACT: 会话存续期间关闭开发者选项后，已注册的工具也不能继续执行。
      if (!isAgentFullAccess()) return { content: [{ type: "text", text: "未开放 Agent 全部权限，无法执行命令" }], details: undefined };
      const { command, timeoutMs } = runCommandSchema.parse(params);
      const output = await runProjectCommand(cwd, command, timeoutMs ?? RUN_COMMAND_DEFAULT_TIMEOUT_MS, signal);
      return { content: [{ type: "text", text: output }], details: undefined };
    },
  };
}

export function createAgentToolContext(cwd: string, config: Record<string, unknown> = {}, canvas?: CanvasContext, question?: QuestionContext, workspaceAvailable = true): ToolContext {
  const host = getAgentHost();
  const skillsDirectory = join(dirname(host.settings.settingsPath()), "skills");
  const requireWorkspace = () => { if (!workspaceAvailable) throw new Error("此对话未提供工作目录，无法使用文件或媒体操作"); };
  const resolvePath = async (path: string, readOnly = false) => {
    requireWorkspace();
    // ACT: 全部权限只放开只读路径；写路径继续走下面的工作区限制，避免项目外写入。
    if (readOnly && isAgentFullAccess()) return resolveAgentReadPath(cwd, path);
    const absolute = resolve(cwd, path);
    const root = readOnly && host.workspace.isWithin(skillsDirectory, absolute) ? skillsDirectory : cwd;
    const target = (await host.workspace.resolveWorkspacePath(root, relative(root, absolute), true)).path;
    // ACT: .toonflow 是应用内部状态目录（上次画布等），Agent 的 ls/read/write 都不能访问。
    if (host.workspace.isWithin(cwd, target) && relative(cwd, target).split(/[\\/]/)[0]?.toLocaleLowerCase() === ".toonflow") {
      throw Object.assign(new Error("项目配置目录不可访问"), { code: "EPROTECTED" });
    }
    return target;
  };
  const withWritePaths = async (paths: string[], operation: (targets: string[]) => Promise<void>) => {
    const targets = await Promise.all(paths.map(path => resolvePath(path)));
    const release = host.workspace.lockWorkspaceFiles(targets);
    try { await operation(targets); }
    finally { release(); }
  };
  const files: ToolFiles = {
    importImage: url => { requireWorkspace(); return host.workspace.importImage(cwd, url); },
    readFile: async (path, readOnly = false) => readFile(await resolvePath(path, readOnly)),
    access: async (path, readOnly = false) => access(await resolvePath(path, readOnly)),
    stat: async (path, readOnly = false) => stat(await resolvePath(path, readOnly)),
    readdir: async (path, readOnly = false) => {
      const target = await resolvePath(path, readOnly);
      const entries = await readdir(target);
      // ACT: 项目根只隐藏应用管理的黑名单条目；用户自己的 .env、.gitignore 等点开头文件照常暴露给 Agent。
      return target === cwd ? entries.filter(name => !host.workspace.isHiddenWorkspaceEntry(name)) : entries;
    },
    detectImageMimeType: async (path, readOnly = false) => {
      const target = await resolvePath(path, readOnly);
      return withFileAccess([target], "read", () => detectSupportedImageMimeTypeFromFile(target));
    },
    writeFile: (path, content, exclusive = false) => withWritePaths([path], async ([target]) => {
      host.workspace.protectWorkspaceLibraryPath(cwd, target);
      await host.workspace.writeWorkspaceFile(target, content, exclusive);
    }),
    mkdir: async (path, recursive = false) => {
      const target = await resolvePath(path);
      // ACT: 项目 library / library-assets 归素材库管理，文件工具不能先占位再让资产库 fallback。
      host.workspace.protectWorkspaceLibraryPath(cwd, target);
      // ACT: 递归创建已有目录无需修改，锁父目录会与 Agent 自己持有的会话文件锁冲突。
      if (recursive && (await stat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }))?.isDirectory()) return;
      const release = host.workspace.lockWorkspaceFiles([target]);
      try { await mkdir(target, { recursive }); }
      finally { release(); }
    },
    rename: (path, target) => withWritePaths([path, target], async ([source, destination]) => {
      host.workspace.protectWorkspaceRoot(cwd, source);
      host.workspace.protectWorkspaceRoot(cwd, destination);
      host.workspace.protectWorkspaceLibraryPath(cwd, source);
      host.workspace.protectWorkspaceLibraryPath(cwd, destination);
      await host.workspace.renameWorkspaceFile(source, resolve(dirname(destination), basename(resolve(cwd, target))));
    }),
    remove: (path, recursive = false) => withWritePaths([path], async ([target]) => {
      host.workspace.protectWorkspaceRoot(cwd, target);
      host.workspace.protectWorkspaceLibraryPath(cwd, target);
      if ((await lstat(target)).isDirectory() && !recursive) await rmdir(target);
      else await rm(target, { recursive });
    }),
    copyFile: (path, target, exclusive = false) => withWritePaths([path, target], async ([source, destination]) => {
      host.workspace.protectWorkspaceLibraryPath(cwd, source);
      host.workspace.protectWorkspaceLibraryPath(cwd, destination);
      await copyFile(source, destination, exclusive ? constants.COPYFILE_EXCL : 0);
    }),
  };
  return {
    cwd, config, files, resolvePath, writeFile: files.writeFile, canvas, question,
    skills: workspaceAvailable ? createSkillContext(cwd) : undefined, assets: workspaceAvailable ? createAssetContext(cwd) : undefined,
    browser: host.browser.createBrowserContext(cwd),
    asr: {
      async transcribe(path, options = {}) {
        requireWorkspace();
        options.signal?.throwIfAborted();
        if (!canvas) throw new Error("当前对话未连接画布，无法使用浏览器语音识别");
        const source = await resolvePath(path);
        const args = asrRequestSchema.parse({ path: relative(cwd, source).replaceAll("\\", "/"), lang: options.lang });
        options.signal?.throwIfAborted();
        const result = await canvas.call({ name: "transcribeAudio", args }, options.signal);
        if (typeof result !== "string") throw new Error("语音识别返回了无效的文本");
        return result;
      },
    },
    ffmpeg: signal => { requireWorkspace(); return host.media.createWorkspaceFfmpeg(cwd, signal); },
    media: workspaceAvailable ? {
      listModels: host.media.listMediaModels,
      generateImage: (request, signal) => host.media.generateMedia(cwd, "image", request, signal),
      generateVideo: (request, signal) => host.media.generateMedia(cwd, "video", request, signal),
      generateAudio: (request, signal) => host.media.generateMedia(cwd, "audio", request, signal),
    } : undefined,
    sdk: {
      defineTool, createWriteToolDefinition, createEditToolDefinition, createLsToolDefinition,
      createReadToolDefinition: (directory, options) => {
        const operations = options?.operations ?? {
          readFile: (path: string) => files.readFile(path, true),
          access: (path: string) => files.access(path, true),
          detectImageMimeType: (path: string) => files.detectImageMimeType(path, true),
        };
        const tool = createReadToolDefinition(directory, { ...options, operations: {
          ...operations,
          readFile: async path => host.documents.readDocument(path, await operations.readFile(path)),
        } });
        return { ...tool, description: `${tool.description}\nHTML、Markdown、JSON、XML、配置和代码文件读取原文；Office、OpenDocument、RTF、EPUB、CSV、PDF 在本地解析为 Markdown。offset/limit 对应读取后的行。扫描 PDF 需要先做 OCR。` };
      },
      detectSupportedImageMimeTypeFromFile: path => files.detectImageMimeType(path, true),
    },
  };
}

// ACT: origin 为 mcp/a2a 时不注册命令工具，避免外部客户端借全权限开关拿到本机 shell。
export async function createAgentTools(cwd: string, canvas?: CanvasContext, question?: QuestionContext, includeMcp = true, allowCommand = true): Promise<ToolDefinition[]> {
  const host = getAgentHost();
  const tools: ToolDefinition[] = [];
  const names = new Set<string>();
  const context = createAgentToolContext(cwd, {}, canvas, question);
  for (const item of await host.tools.listTools()) {
    if (!item.enabled) continue;
    if (item.loadError) throw new Error(`${item.displayName}：${item.loadError}`);
    const { plugin, metadata } = await host.tools.loadTool(item.name);
    const config = host.tools.validateToolConfig(plugin, item.config);
    const definitions = await plugin.createTools({ ...context, config });
    for (const tool of definitions) {
      if (!tool.name || typeof tool.execute !== "function") throw new Error(host.i18n.t`${item.displayName} 返回了无效的工具`);
      if (names.has(tool.name)) throw new Error(host.i18n.t`工具名称重复：${tool.name}`);
      names.add(tool.name);
      tools.push({
        ...tool,
        promptGuidelines: [
          ...(metadata.prompt ? [metadata.prompt] : []),
          ...(tool.promptGuidelines ?? []),
        ],
      });
    }
  }
  // ACT: shell 只在开发者明确开启「开放 Agent 全部权限」时注册；origin 为 mcp/a2a 时传 allowCommand=false 再挡一层。
  if (isAgentFullAccess() && allowCommand) {
    const runCommand = createRunCommandTool(cwd);
    // ACT: 插件已占用同名工具时跳过内置实现，不能让一次命名冲突导致整个 Agent 会话不可用。
    if (names.has(runCommand.name)) console.warn("内置工具名与插件冲突，已跳过：runCommand");
    else {
      names.add(runCommand.name);
      tools.push(runCommand);
    }
  }
  if (includeMcp) tools.push(...await host.mcp.createMcpAgentTools() as ToolDefinition[]);
  return tools;
}
