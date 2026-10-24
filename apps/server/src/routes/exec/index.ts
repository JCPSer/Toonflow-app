import { stat } from "@toonflow/file";
import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { validationOptions } from "@/lib/i18n";
import u from "@/utils";

const inputSchema = z.object({
  requestId: z.uuid(),
  directory: z.string().min(1).max(4096),
  command: z.string().min(1).max(20000),
  cwd: z.string().max(4096).default(""),
  timeoutMs: z.number().int().min(0).max(3600000).default(600000),
}).strict();

// ACT: 命令可能长时间占用 CPU 和内存，单进程内限制并发，避免一次画布运行拖垮整个服务。
const maxActiveCommands = 8;
let activeCommands = 0;
const maxPendingBytes = 256 * 1024;
const maxWritableBytes = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ACT: 截到不超过 limit 字节的完整前缀，避免把多字节字符或代理对切坏。
function takeBytes(text: string, limit: number) {
  if (encoder.encode(text).length <= limit) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, mid)).length <= limit) low = mid;
    else high = mid - 1;
  }
  if (low > 0 && text.charCodeAt(low - 1) >= 0xd800 && text.charCodeAt(low - 1) <= 0xdbff) low--;
  return text.slice(0, low);
}

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  if (!u.workspace.isLocalWorkspaceRequest(req)) throw Object.assign(new Error("仅允许本机 Toonflow 页面执行命令"), { status: 403 });
  const input = inputSchema.parse(req.body, validationOptions());
  const root = await u.workspace.resolveWorkspace(req, input.directory);
  // ACT: 复用工作区路径解析，拒绝绝对路径、.. 和指向工作区外的符号链接，不手写越界判断。
  const cwd = (await u.workspaceFile.resolveWorkspacePath(root, input.cwd)).path;
  if (!(await stat(cwd)).isDirectory()) throw Object.assign(new Error("工作目录不是文件夹"), { status: 400 });
  if (activeCommands >= maxActiveCommands) throw Object.assign(new Error("同时运行的命令过多"), { status: 429 });
  activeCommands++;
  // ACT: 键用工作区根目录而不是子目录 cwd；取消接口只拿得到 directory，必须能算出同一个键。
  const requestKey = `${root}\0${input.requestId}`;
  const finished = Promise.withResolvers<void>();
  const readers: { cancel(): Promise<void> }[] = [];
  let registered = false;
  let settled = false;
  let timedOut = false;
  let terminated = false;
  let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const terminate = () => {
    if (terminated) return;
    terminated = true;
    const ptr = child;
    if (!ptr) return;
    // ACT: Windows 没有 POSIX 进程组，只能用 taskkill /T 结束 cmd 拉起的整棵进程树。
    if (process.platform === "win32") {
      Bun.spawn(["taskkill", "/pid", String(ptr.pid), "/T", "/F"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
        .exited.then(code => { if (code !== 0) ptr.kill("SIGKILL"); }).catch(() => { try { ptr.kill("SIGKILL"); } catch {} });
      return;
    }
    try {
      // ACT: detached 后 shell 是进程组组长；向负 pid 发信号才能结束 sh -c 里的子进程，而不只是 shell。
      process.kill(-ptr.pid, "SIGKILL");
    } catch {
      try { ptr.kill("SIGKILL"); } catch {}
    }
  };
  // ACT: Bun 的断开事件不可靠，这三个监听仅作兜底，真正的终止入口是 /api/exec/cancel。
  const stop = () => { if (!settled) terminate(); };

  try {
    const isWindows = process.platform === "win32";
    const shell = isWindows ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/sh";
    // ACT: Windows 的 cmd 用 /d /s /c 执行命令；POSIX 用 -lc 保证加载用户 PATH 和别名。
    const argv = isWindows ? [shell, "/d", "/s", "/c", input.command] : [shell, "-lc", input.command];

    // ACT: 注册先于启动进程，重复 requestId 在拉起任何命令前就以 409 拒绝。
    u.exec.registerExec(requestKey, { terminate, finished: finished.promise });
    registered = true;
    const startedAt = Date.now();
    // ACT: detached 让 shell 成为独立进程组组长，终止时才能连带 sh -c 拉起的子进程一起结束。
    const ptr = child = Bun.spawn(argv, {
      cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true,
    });
    // ACT: 超时紧跟在 spawn 成功后生效，不能等到响应头阶段；之后任何抛出都要经 finally 终止进程。
    if (input.timeoutMs > 0) timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      terminate();
    }, input.timeoutMs);

    const send = (event: Record<string, unknown>) => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const pending = { stdout: "", stderr: "" };
    const pendingBytes = { stdout: 0, stderr: 0 };
    let droppedBytes = 0;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (flushTimer !== undefined) { clearTimeout(flushTimer); flushTimer = undefined; }
      // ACT: 超出上限被丢弃的字节先于正常数据告知客户端。
      if (droppedBytes > 0) { send({ type: "truncated", dropped: droppedBytes }); droppedBytes = 0; }
      for (const type of ["stdout", "stderr"] as const) {
        const data = pending[type];
        if (!data) continue;
        pending[type] = "";
        pendingBytes[type] = 0;
        if (res.destroyed || res.writableEnded) continue;
        const bytes = Buffer.byteLength(data);
        // ACT: 慢客户端不再无限缓冲：内部写缓冲超过 8MB 时丢弃该块并计入 truncated。
        if (res.writableLength > maxWritableBytes) { droppedBytes += bytes; continue; }
        if (!res.write(`data: ${JSON.stringify({ type, data })}\n\n`)) droppedBytes += bytes;
      }
      // ACT: flush 过程中因背压丢弃的字节也要告知，不能留到没有下一次 flush。
      if (droppedBytes > 0) { send({ type: "truncated", dropped: droppedBytes }); droppedBytes = 0; }
    };
    // ACT: 命令输出常按字节碎片到达，按 300ms 合并再发，避免每个碎块一条 SSE 事件。
    const enqueue = (type: "stdout" | "stderr", data: string) => {
      if (!data) return;
      // ACT: 单流待发缓冲上限 256KiB，超出部分直接丢弃并累计到 truncated。
      const bytes = Buffer.byteLength(data);
      const room = maxPendingBytes - pendingBytes[type];
      if (bytes <= room) {
        pending[type] += data;
        pendingBytes[type] += bytes;
      } else if (room > 0) {
        const kept = takeBytes(data, room);
        const keptBytes = Buffer.byteLength(kept);
        pending[type] += kept;
        pendingBytes[type] += keptBytes;
        droppedBytes += bytes - keptBytes;
      } else {
        droppedBytes += bytes;
      }
      flushTimer ??= setTimeout(flush, 300);
    };
    const read = async (stream: ReadableStream<Uint8Array>, type: "stdout" | "stderr") => {
      const reader = stream.getReader();
      readers.push(reader);
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          enqueue(type, decoder.decode(value, { stream: true }));
        }
        enqueue(type, decoder.decode());
      } catch {
        // ACT: 进程被终止或连接断开时管道读取会失败，退出事件仍须照常发出。
      } finally {
        reader.releaseLock();
      }
    };
    const reading = Promise.all([read(ptr.stdout, "stdout"), read(ptr.stderr, "stderr")]);

    res.once("close", stop);
    req.once("aborted", stop);
    req.socket.once("close", stop);

    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!res.destroyed) res.write(": keepalive\n\n"); }, 5000);
    send({ type: "start", pid: ptr.pid, cmd: input.command, cwd, shell });

    await ptr.exited;
    settled = true;
    // ACT: 后台子进程可能继承并一直占用输出管道，进程退出后只再等 100ms 收尾，避免连接悬挂。
    await Promise.race([reading, delay(100)]);
    // ACT: 取消读取和等待读取都可能永不 settle，各用 1s 上限兜底，超时也照常发 exit。
    await Promise.race([Promise.all(readers.map(reader => reader.cancel().catch(() => {}))), delay(1000)]);
    await Promise.race([reading, delay(1000)]);
    flush();
    send({ type: "exit", code: ptr.exitCode, signal: ptr.signalCode, durationMs: Date.now() - startedAt, timedOut, killed: terminated });
    res.end();
  } finally {
    // ACT: spawn 之后任何抛出（响应头、写事件等）都要在这里结束进程，不能只依赖正常路径。
    if (!settled) terminate();
    await Promise.race([Promise.all(readers.map(reader => reader.cancel().catch(() => {}))), delay(1000)]);
    clearInterval(heartbeat);
    clearTimeout(timeout);
    res.off("close", stop);
    req.off("aborted", stop);
    req.socket.off("close", stop);
    if (registered) u.exec.unregisterExec(requestKey);
    activeCommands--;
    finished.resolve();
  }
});
