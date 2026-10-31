import { setLocaleFallback, t, translateMessage } from "@toonflow/server/i18n";
import { setRuntimeHost } from "@toonflow/server/platform";
import { detectLocale, normalizeLocale } from "@toonflow/i18n";
import { execFile, spawn } from "node:child_process";
import { existsSync, writeAtomicSync } from "@toonflow/file";
import { file } from "@toonflow/file/bun";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { dlopen, FFIType, ptr } from "bun:ffi";
import type { DesktopRuntime, PluginInstallRequest } from "@toonflow/server/desktop";
import { showNativeSplash } from "@toonflow/startup";
import Electrobun, { ApplicationMenu, BrowserWindow, PATHS, Screen, Utils, Updater } from "electrobun/main";
import { dataDirectoryName, legacyDataDirectoryName, resolveDesktopDataDirectory } from "./dataDirectory";
import { parseInstallUrl } from "./protocol";
import saveFile, { selectSaveFile, takeSaveTarget } from "./saveFile";
import createWindowsUpdater, { confirmWindowsUpdateStartup } from "./update/windowsUpdater";
import prepareWebviewRuntime from "./webviewRuntime";
import { clampToDisplays, loadWindowState, saveWindowState, WINDOW_MARGIN, type WindowFrame } from "./windowState";

// ACT: 窗口几何状态放在模块级，关闭闸门后续可在任意时点调用 flushWindowState() 强制落盘。
let activeWindow: BrowserWindow | undefined;
let windowStatePath: string | undefined;
/** 已确认的普通窗口几何（不含最大化时的屏幕几何）。 */
let committedFrame: WindowFrame | undefined;
let trackedMaximized = false;
/**
 * 启动时读取的最大化恢复意图。首次 show()/maximize() 生效前，启动期的 resize/move
 * 几何事件不能把它清掉，否则 ready() 里的 maximize() 会被提前跳过。
 * 观察到窗口确实最大化后视为已消费；此后用户取消最大化由 commitPendingFrame 正常清除。
 */
let restoreMaximized = false;
/** resize/move 事件累积的最新几何，等待 400ms 防抖提交。 */
let pendingFrame: WindowFrame | undefined;
let geometryTimer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function collectEventFrame(event: unknown, withSize: boolean): WindowFrame | undefined {
  const data = (event as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object") return undefined;
  const { x, y, width, height } = data as Record<string, unknown>;
  // ACT: SDK 的 move 事件只带 x/y，尺寸沿用最近一帧，避免为取尺寸再走一次 FFI。
  const base = pendingFrame ?? committedFrame;
  const nextWidth = withSize ? width : base?.width;
  const nextHeight = withSize ? height : base?.height;
  const values = [x, y, nextWidth, nextHeight];
  if (!values.every(value => typeof value === "number" && Number.isFinite(value))) return undefined;
  const frame = {
    x: Math.round(x as number),
    y: Math.round(y as number),
    width: Math.round(nextWidth as number),
    height: Math.round(nextHeight as number),
  };
  return frame.width > 0 && frame.height > 0 ? frame : undefined;
}

function commitPendingFrame() {
  geometryTimer = undefined;
  const frame = pendingFrame;
  pendingFrame = undefined;
  const window = activeWindow;
  if (!frame || !window) return;
  try {
    // ACT: 最小化/全屏时的事件几何不是普通窗口状态，直接丢弃，避免污染 normal 或 maximized。
    if (window.isMinimized() || window.isFullScreen()) return;
    if (window.isMaximized()) {
      trackedMaximized = true;
      // ACT: maximize 已真实生效，启动时的恢复意图消费完毕。
      restoreMaximized = false;
      return;
    }
  } catch (error) {
    console.error("读取窗口状态失败：", error);
    return;
  }
  committedFrame = frame;
  // ACT: 首次 show/maximize 生效前的启动期几何事件不代表用户取消最大化；
  // 保留启动意图，避免它在 ready() 执行 maximize() 之前被清成 false。
  if (!restoreMaximized) trackedMaximized = false;
}

function persistWindowState() {
  persistTimer = undefined;
  if (!windowStatePath || !committedFrame) return;
  saveWindowState(windowStatePath, { version: 1, normal: committedFrame, maximized: trackedMaximized });
}

function handleGeometryEvent(event: unknown, withSize: boolean) {
  const frame = collectEventFrame(event, withSize);
  if (!frame) return;
  pendingFrame = frame;
  if (geometryTimer) clearTimeout(geometryTimer);
  geometryTimer = setTimeout(commitPendingFrame, 400);
  // ACT: 拖动/缩放期间不落盘，静默 2s 后才写，减少磁盘写入。
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistWindowState, 2000);
}

/** 关闭闸门复用：合并未提交的 pendingFrame 并同步写盘，可重复调用。 */
export function flushWindowState() {
  if (geometryTimer) {
    clearTimeout(geometryTimer);
    geometryTimer = undefined;
  }
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  // ACT: 关闭时把 <400ms 内尚未经防抖判定的几何并入 normal，保证最后一次拖动/缩放不丢失。
  // 必须复用同一套判定：最大化/全屏/最小化时的几何不能写进 normal，否则下次"还原"会得到屏幕大小。
  commitPendingFrame();
  persistWindowState();
}

const execFileAsync = promisify(execFile);

// ACT: macOS 目录选择器由随包的 folder-picker.app 提供（apps/desktop/native/folderPicker.m）。
// 它自带 zh-Hans 本地化、能新建文件夹、按鼠标所在屏幕居中；缺包或异常时返回 undefined 让调用方回退。
// ACT: 与 startup/tools 一致，打包把 mac/ 放在 Resources/app 下，而 VIEWS_FOLDER 指向 Resources/app/views。
const macFolderPicker = resolve(PATHS.VIEWS_FOLDER, "../mac/folder-picker.app/Contents/MacOS/folder-picker");
// ACT: macOS 14+ 把 App 激活改成「由用户意图驱动的请求」：子进程自己 activate 只有约 40% 成功率
// （实测 5 次点击里 3 次失败，面板可见但永远不是 key window）。Apple 给的确定性路径是让当前
// active 的宿主 App 先把激活权 yield 给目标进程。这段能力放在随包的小 dylib 里，用 dlopen 调。
const macActivationLibrary = resolve(PATHS.VIEWS_FOLDER, "../mac/libToonflowActivation.dylib");
let yieldActivationTo: ((pid: number) => void) | undefined;
if (process.platform === "darwin" && existsSync(macActivationLibrary)) {
  try {
    const { symbols } = dlopen(macActivationLibrary, {
      tnf_yield_activation_to_pid: { args: [FFIType.i32], returns: FFIType.void },
    });
    yieldActivationTo = (pid) => symbols.tnf_yield_activation_to_pid(pid);
  } catch (error) {
    console.error("加载 macOS 激活辅助库失败：", error);
  }
}
let lastFolderPickerDirectory: string | undefined;

/**
 * 拉起随包的原生选择器并等它返回。
 * 返回值：选中路径；null 表示用户取消。启动失败/异常退出直接抛错——**不回退到
 * Utils.openFileDialog**，那是同步 FFI，会把整个 Bun 事件循环（连同 HTTP 服务）冻住。
 */
function runMacPicker(args: string[]): Promise<string | null> {
  if (!existsSync(macFolderPicker)) return Promise.reject(new Error(t`缺少 macOS 选择器，请重新安装应用`));
  return new Promise<string | null>((resolvePicked, rejectPicked) => {
    const child = spawn(macFolderPicker, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", error => rejectPicked(error));
    child.on("close", (code, signal) => {
      // ACT: 选择器是自己退出的（用户取消 / 选中）；被信号杀掉时后续还有重试，不该吞。
      if (signal) return rejectPicked(new Error(t`选择器被中断`));
      if (code !== 0) return rejectPicked(new Error(stderr.trim() || t`选择器异常退出`));
      resolvePicked(stdout.trim() || null);
    });
    // ACT: 让权要赶在孩子自己 activate 之前发起；dylib 内部会重试约 1 秒直到查到该进程。
    if (child.pid && yieldActivationTo) yieldActivationTo(child.pid);
  });
}
const pendingInstalls: PluginInstallRequest[] = [];
let deliverInstall: ((request: PluginInstallRequest) => void) | undefined;
function openUrl(url: string) {
  const request = parseInstallUrl(url);
  if (deliverInstall) deliverInstall(request);
  else if (!pendingInstalls.some(item => item.type === request.type && item.url === request.url)) {
    if (pendingInstalls.length >= 20) throw new Error(t`待确认的安装请求过多，请稍后重试`);
    pendingInstalls.push(request);
  }
}
// 冷启动的 macOS URL 可能先于窗口就绪到达，先接收再等待页面挂载。
Electrobun.events.on("open-url", event => {
  try { openUrl(event.data.url); }
  catch (error) {
    void Utils.showMessageBox({ type: "error", title: t`安装链接无效`, message: translateMessage(error instanceof Error ? error.message : "无法打开安装链接") });
  }
});

async function restoreInstallRegistration(installDirectory: string) {
  const uninstaller = resolve(installDirectory, "UninstallNSIS.exe");
  if (process.platform === "win32" && existsSync(uninstaller)) {
    try {
      // SDK 启动和更新会重写卸载入口；安装了 NSIS 时统一交给它处理数据保留选项。
      const { identifier, channel } = await file(resolve(PATHS.RESOURCES_FOLDER, "version.json")).json();
      const registryKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${identifier}.${channel}`;
      for (const [name, command] of [["UninstallString", `"${uninstaller}"`], ["QuietUninstallString", `"${uninstaller}" /S`]]) {
        await execFileAsync("reg.exe", ["add", registryKey, "/v", name, "/t", "REG_SZ", "/d", command, "/f"], { windowsHide: true });
      }
      const protocolLauncher = resolve(PATHS.RESOURCES_FOLDER, "app/protocolLauncher.exe");
      if (existsSync(protocolLauncher)) {
        const protocolKey = "HKCU\\Software\\Classes\\toonflow";
        const commandKey = `${protocolKey}\\shell\\open\\command`;
        const command = `"${protocolLauncher}" "%1"`;
        let protocolExists = true;
        try {
          await execFileAsync("reg.exe", ["query", protocolKey], { windowsHide: true });
        } catch (error) {
          if ((error as { code?: number }).code !== 1) throw error;
          protocolExists = false;
        }
        // ACT: 自动更新不经过 NSIS；仅补全缺失协议，已有注册（包括其他安装）保持不动。
        if (!protocolExists) {
          for (const [key, value] of [[protocolKey, "URL:Toonflow Protocol"], [`${protocolKey}\\DefaultIcon`, `"${resolve(PATHS.RESOURCES_FOLDER, "app.ico")}",0`], [commandKey, command]]) {
            await execFileAsync("reg.exe", ["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"], { windowsHide: true });
          }
          await execFileAsync("reg.exe", ["add", protocolKey, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"], { windowsHide: true });
        }
      }
    } catch (error) {
      console.error("恢复桌面安装注册信息失败：", error);
    }
  }
}

async function start() {
  let splash: Awaited<ReturnType<typeof showNativeSplash>> | undefined;
  let desktopConnection: Awaited<ReturnType<typeof import("./connection").default>> | undefined;
  let isClosing = false;
  // 关闭闸门状态：allowClose 为本轮退出已放行；closeGate 保证单飞；pageReady 表示页面 JS 可接收 flush；
  // forceQuit 用于启动失败等必须立刻退出的路径，跳过所有 veto。
  let allowClose = false;
  // ACT: 更新器退出批准是独立的一次性状态。更新失败/取消时进程不会退出，
  // 若复用 allowClose 会永久跳过后续真实关窗的前端 flush。
  let updateQuitApproved = false;
  let closeGate: Promise<void> | null = null;
  let pageReady = false;
  let forceQuit = false;
  // 前端 flush-done 回执的等待者；闸门单飞，同一时间最多一个。
  let resolveFlushDone: (() => void) | undefined;

  try {
    // Windows 的数据目录与 app 同级；macOS 的与 .app 同级，避免随程序更新被替换。
    const installDirectory = resolve(PATHS.RESOURCES_FOLDER, process.platform === "darwin" ? "../../.." : "../..");
    // ACT: 迁移逻辑自身已兜住所有分支；这里再包一层，保证任何意外都不会让应用启动失败。
    const dataDirectory = await resolveDesktopDataDirectory(installDirectory).catch((error) => {
      console.error("解析桌面数据目录失败，回退到旧目录：", error);
      const migrated = resolve(installDirectory, dataDirectoryName);
      return existsSync(migrated) ? migrated : resolve(installDirectory, legacyDataDirectoryName);
    });
    // ACT: 先显示原生动画，再加载服务，避免初始化期间没有反馈。
    const startupSettings = await file(resolve(dataDirectory, "settings.json")).json().catch((error) => {
      if (error.code !== "ENOENT") console.error("读取启动设置失败，使用默认启动动画：", error);
      return null;
    });
    setLocaleFallback(() => normalizeLocale(startupSettings?.settings?.ui?.language)
      ?? detectLocale([Intl.DateTimeFormat().resolvedOptions().locale]));
    if (process.platform === "darwin") {
      // ACT: WKWebView 的 Command 编辑快捷键由原生菜单角色交给当前响应者处理。
      ApplicationMenu.setApplicationMenu([
        { label: "Toonflow", submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "showAll" },
          { type: "separator" },
          // ACT: electrobun 只为编辑类 role 自动分配快捷键，role: "quit" 拿不到 ⌘Q（按下只剩系统提示音）；
          // 改用显式 action + accelerator，由 application-menu-clicked 回调接管。
          { label: t`退出 Toonflow`, accelerator: "command+q", action: "quit" },
        ] },
        { label: t`编辑`, submenu: [
          { role: "undo", label: t`撤销` },
          { role: "redo", label: t`重做` },
          { type: "separator" },
          { role: "cut", label: t`剪切` },
          { role: "copy", label: t`复制` },
          { role: "paste", label: t`粘贴` },
          { role: "selectAll", label: t`全选` },
        ] },
      ]);
    }
    try {
      if (startupSettings?.settings?.ui?.startupAnimation !== false) {
        splash = await showNativeSplash(resolve(PATHS.VIEWS_FOLDER, "../startup"), () => {
          isClosing = true;
          splash = undefined;
          Utils.quit();
        });
      }
    } catch (error) {
      console.error("原生启动画面创建失败：", error);
    }
    if (isClosing) {
      splash?.close();
      return;
    }
    setRuntimeHost("desktop");
    const { createApp } = await import("@toonflow/server/app");
    const { closeBrowsers } = await import("@toonflow/server/browser");
    const { hash, version } = await file(resolve(PATHS.RESOURCES_FOLDER, "version.json")).json();
    if (typeof hash !== "string" || !hash) throw new Error(t`应用构建标识缺失，无法同步内置插件`);
    const app = await createApp({
      webRoot: resolve(PATHS.VIEWS_FOLDER, "mainview"),
      appVersion: typeof version === "string" ? version : "",
      dataDirectory,
      toolsRoot: resolve(PATHS.VIEWS_FOLDER, "../tools"),
      nodesRoot: resolve(PATHS.VIEWS_FOLDER, "../nodes"),
      extRoot: resolve(PATHS.VIEWS_FOLDER, "../ext"),
      providersRoot: resolve(PATHS.VIEWS_FOLDER, "../providers"),
      skillsRoot: resolve(PATHS.VIEWS_FOLDER, "../skills"),
      // ACT: 暂不安装内置团队，随团队打包一同恢复。
      // agentsRoot: resolve(PATHS.VIEWS_FOLDER, "../agents"),
      pluginRevision: hash,
    });
    const { default: createDesktopConnection } = await import("./connection");
    const connection = desktopConnection = await createDesktopConnection(app, dataDirectory, resolve(PATHS.VIEWS_FOLDER, "../mcp/stdio.js"), (port, remote) => {
      deliverInstall = undefined;
      saveRuntime(port);
      mainWindow.webview.setNavigationRules(getNavigationRules(port));
      mainWindow.webview.loadURL(`http://127.0.0.1:${port}/?desktop=1${remote ? "&remote=1" : ""}`);
    }, error => {
      console.error("设备连接切换失败：", error);
      void Utils.showMessageBox({ type: "error", title: t`设备连接失败`, message: error instanceof Error ? error.message : String(error) });
    });
    await prepareWebviewRuntime(PATHS.RESOURCES_FOLDER);
    if (isClosing) { await connection.close(); return; }
    console.log(`桌面服务：http://127.0.0.1:${connection.port}`);

    const { workArea } = Screen.getPrimaryDisplay();
    // ACT: 宽高分别限制在屏幕可用区域内，预留标题栏和边距，不固定比例。
    const defaultWidth = Math.min(1280, workArea.width - WINDOW_MARGIN);
    const defaultHeight = Math.min(960, workArea.height - WINDOW_MARGIN);
    // 无保存值或显示器信息异常时的默认居中窗口。
    const defaultFrame: WindowFrame = {
      width: defaultWidth,
      height: defaultHeight,
      x: workArea.x + Math.round((workArea.width - defaultWidth) / 2),
      y: workArea.y + Math.round((workArea.height - defaultHeight) / 2),
    };
    windowStatePath = resolve(dataDirectory, "windowState.json");
    const savedWindowState = loadWindowState(windowStatePath);
    const initialFrame = savedWindowState
      ? clampToDisplays(savedWindowState.normal, Screen.getAllDisplays(), defaultFrame)
      : defaultFrame;
    committedFrame = initialFrame;
    trackedMaximized = savedWindowState?.maximized ?? false;
    // ACT: 启动意图独立保存，供 ready() 首次 show() 后可靠执行 maximize()。
    restoreMaximized = trackedMaximized;
    const mainWindow = new BrowserWindow({
      title: "Toonflow",
      url: `http://127.0.0.1:${connection.port}/?desktop=1${connection.remote ? "&remote=1" : ""}`,
      navigationRules: JSON.stringify(getNavigationRules(connection.port)),
      // ACT: Windows SDK 未接管普通新窗口请求，在创建 WebView 弹窗前交给宿主。
      preload: `
        (() => {
          function openExternal(url) {
            const target = new URL(url, document.baseURI);
            if (!["http:", "https:"].includes(target.protocol)) return false;
            if (window === window.top && target.origin === window.location.origin) return false;
            window.__electrobunSendToHost({ type: "openExternal", url: target.href });
            return true;
          }
          const openWindow = window.open.bind(window);
          window.open = (url, ...options) => url && openExternal(url) ? null : openWindow(url, ...options);
          function openLink(event) {
            if (event.button !== 0 && event.button !== 1) return;
            const link = event.composedPath().find(element => element instanceof HTMLAnchorElement);
            if (!link?.href || !openExternal(link.href)) return;
            event.preventDefault();
          }
          window.addEventListener("click", openLink, true);
          window.addEventListener("auxclick", openLink, true);
        })();
      `,
      hidden: Boolean(splash),
      frame: initialFrame,
    });
    activeWindow = mainWindow;
    // ACT: 主进程不知道当前挂载了几个画布实例，前端预算按「2s 基础 + 每实例 0.5s」计算；
    // 这里取 4s 作为该公式的保守上界（2s + 4 个实例），既覆盖多画布保存，也不会让首页/失败页关窗长时间无响应。
    const FLUSH_TIMEOUT_MS = 4000;

    /** 等待页面回执；无论成功、失败还是超时都只结算一次。 */
    function waitForFlushDone() {
      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (resolveFlushDone === finish) resolveFlushDone = undefined;
          resolve();
        };
        resolveFlushDone = finish;
        const timer = setTimeout(finish, FLUSH_TIMEOUT_MS);
      });
    }

    async function flushFrontendState() {
      if (!pageReady) return;
      // ACT: 先登记回执等待者再执行脚本，避免页面在 executeJavascript 返回前就回执导致丢消息。
      const done = waitForFlushDone();
      try {
        mainWindow.webview?.executeJavascript("window.__toonflowFlush?.()");
      } catch (error) {
        // 页面不可用时不必等满超时，直接放行。
        console.error("通知页面保存状态失败：", error);
        resolveFlushDone?.();
      }
      await done;
    }

    /**
     * 关闭闸门：等待前端落盘 → 写窗口几何 → 放行本轮退出。
     * 绝不在 will-close / before-quit 的回调栈内直接 close()/requestClose()，统一用 setTimeout 跳出。
     */
    function runGate(kind: "close" | "quit" | "update") {
      // ACT: 单飞。标题栏关闭、Dock 退出、更新重启可能连续触发，复用同一轮保存与放行。
      if (closeGate) return closeGate;
      const task = (async () => {
        try {
          await flushFrontendState();
          // ACT: 闸门末端合并 pendingFrame 后落盘；最大化/全屏等判定仍复用 flushWindowState。
          flushWindowState();
        } finally {
          // 即使前端保存异常也必须放行，否则窗口将无法关闭。
          // ACT: update 只申请一次性退出批准；真实关窗/退出才置 allowClose。
          if (kind === "update") updateQuitApproved = true;
          else allowClose = true;
        }
      })();
      closeGate = task;
      void task.catch(error => console.error("关闭前保存失败：", error)).finally(() => {
        // ACT: kind=update 由更新器自己重启，这里只负责保存与放行，绝不能关窗。
        if (kind !== "close" && kind !== "quit") return;
        setTimeout(() => kind === "quit" ? Utils.quit() : mainWindow.close(), 0);
      });
      return task;
    }

    mainWindow.on("will-close", (event: unknown) => {
      if (allowClose || updateQuitApproved) return;
      // ACT: 原生会同步读取 response；必须先同步 veto，再异步跑闸门。
      (event as { response: { allow: boolean } }).response = { allow: false };
      void runGate("close");
    });
    // ACT: Dock 退出/系统注销走 before-quit（菜单 ⌘Q 已改为 requestClose 走 will-close）。
    Electrobun.events.on("before-quit", (event: { response?: { allow: boolean } }) => {
      if (allowClose || updateQuitApproved || forceQuit || !activeWindow) return;
      // ACT: 与 will-close 相同，必须同步 veto；异步结束后由闸门调用 Utils.quit()。
      event.response = { allow: false };
      void runGate("quit");
    });
    // ACT: 更新器内部只申请一次 quit 批准，被 veto 就会放弃整次更新；
    // 因此先跑 update 闸门把 updateQuitApproved 置 true，再让真实 applyUpdate 走 requestQuitApproval。
    function withUpdateGate(target: DesktopRuntime["updater"]): DesktopRuntime["updater"] {
      if (typeof target.applyUpdate !== "function") return target;
      const applyUpdate = target.applyUpdate.bind(target);
      return {
        ...target,
        async applyUpdate() {
          // ACT: 只清理本次 update 闸门自己建立的放行状态；若复用了正在进行的真实关窗闸门，
          // 绝不回滚「已完成真实关窗」的 allowClose/closeGate。
          const ownsGate = closeGate === null && !allowClose;
          try {
            await runGate("update");
            await applyUpdate();
          } finally {
            // ACT: 更新器在 applyUpdate 内同步申请并消费 quit 批准：
            // 成功时已排程退出（Windows 300ms 后 quitAfterApproval），失败/取消时进程继续运行。
            // 两种情况都必须撤销一次性批准并清掉已结算的闸门，否则下一次真实关窗会跳过 flush。
            if (ownsGate) {
              updateQuitApproved = false;
              closeGate = null;
            }
          }
        },
      };
    }
    // ACT: 窗口事件自带几何数据，不调 FFI；400ms 防抖后判定 maximized，静默 2s 后落盘。
    mainWindow.on("resize", (event: unknown) => handleGeometryEvent(event, true));
    mainWindow.on("move", (event: unknown) => handleGeometryEvent(event, false));
    // ACT: 菜单里的「退出」改为 action 项后必须自行接管；requestClose 会走原生 will-close 闸门，
    // 保存完成后再真正关闭，复用已有的连接与浏览器清理。
    ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
      const detail = (event as { data?: { action?: unknown } }).data;
      if (detail?.action === "quit" && !isClosing) mainWindow.requestClose();
    });
    let isControlHeld = () => false;
    let navigationTimer: ReturnType<typeof setTimeout> | undefined;
    function openLink(detail: unknown) {
      if (isClosing) return;
      const url = typeof detail === "string" ? detail : detail && typeof detail === "object" && "url" in detail ? detail.url : undefined;
      if (typeof url !== "string" || !URL.canParse(url)) return;
      const target = new URL(url);
      if (target.protocol !== "http:" && target.protocol !== "https:") return;
      const current = new URL(mainWindow.webview.url!);
      if (process.platform === "win32" && target.origin === current.origin && target.pathname === current.pathname && target.search === current.search) {
        // ACT: SDK 把 Ctrl 刷新误判为新窗口；松开后恢复内部导航，避免再次触发误判。
        clearTimeout(navigationTimer);
        const navigate = () => {
          if (isClosing) return;
          if (isControlHeld()) { navigationTimer = setTimeout(navigate, 50); return; }
          navigationTimer = undefined;
          mainWindow.webview.loadURL(target.href);
        };
        navigate();
        return;
      }
      if (!Utils.openExternal(target.href)) {
        void Utils.showMessageBox({ type: "error", title: t`打开链接失败`, message: t`请检查默认浏览器设置后重试。` });
      }
    }
    // ACT: 两版 SDK 的全局事件不带 WebView ID，使用事件名后缀限定主窗口。
    Electrobun.events.on(`new-window-open-${mainWindow.webview.id}`, (event: { data: { detail: unknown } }) => openLink(event.data.detail));
    Electrobun.events.on(`host-message-${mainWindow.webview.id}`, (event: { data: { detail: unknown } }) => {
      let detail = event.data.detail;
      // ACT: 2.0.1 已把 host-message 的 JSON 解析成对象；这里兼容字符串形式，避免版本差异导致回执丢失。
      if (typeof detail === "string") {
        try { detail = JSON.parse(detail); }
        catch { /* 非 JSON 消息忽略。 */ }
      }
      if (!detail || typeof detail !== "object" || !("type" in detail)) return;
      if (detail.type === "openExternal") openLink(detail);
      // flush-done 用于结算关闭闸门的等待；重复或过期的回执在这里自然无效。
      else if (detail.type === "flush-done") resolveFlushDone?.();
      else if (detail.type === "desktop-notify") {
        const { title, body, silent } = detail as { title?: unknown; body?: unknown; silent?: unknown };
        // ACT: 通知是尽力而为：未授权或平台不支持时原生层会拒绝，这里静默失败，绝不能影响主进程。
        if (typeof title === "string" && title.trim() && typeof body === "string") {
          try { Utils.showNotification({ title: title.slice(0, 120), body: body.slice(0, 300), silent: silent === true }); }
          catch (error) { console.error("显示桌面通知失败：", error); }
        }
      }
    });
    // 页面重载时监听器随旧页面销毁，安装请求等新页面 ready 后再投递。
    Electrobun.events.on(`will-navigate-${mainWindow.webview.id}`, (event: { data: { detail: unknown } }) => {
      let detail = event.data.detail;
      if (typeof detail === "string") {
        try { detail = JSON.parse(detail); }
        catch { /* 兼容直接携带 URL 的导航通知。 */ }
      }
      if (detail && typeof detail === "object" && "allowed" in detail && detail.allowed === false) {
        openLink(detail);
        return;
      }
      // ACT: 页面开始真实导航后旧页面脚本即将销毁，闸门不得再向它派发 flush；等新页面 ready() 再置回。
      pageReady = false;
      deliverInstall = undefined;
    });
    let isShowing = false;
    app.locals.desktop = {
      openUrl,
      showItemInFolder: Utils.showItemInFolder,
      readClipboardText: Utils.clipboardReadText,
      readClipboardImage: Utils.clipboardReadImage,
      writeClipboardImage: Utils.clipboardWriteImage,
      writeClipboardText: Utils.clipboardWriteText,
      selectSaveFile,
      saveFile,
      takeSaveTarget,
      async selectOpenFile(extension: string) {
        // ACT: 文件选择也走随包 helper（子进程）。Electrobun 的 openFileDialog 是同步 FFI，
        // 面板打开期间会冻结整个主进程（HTTP 服务与正在跑的 Agent 一起停）。
        if (process.platform === "darwin") return await runMacPicker(["--mode", "file", "--ext", extension]);
        const [path] = await Utils.openFileDialog({ allowedFileTypes: extension, canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: false });
        return path ?? null;
      },
      async selectProviderFile() {
        if (process.platform === "darwin") return await runMacPicker(["--mode", "file", "--ext", "ts"]);
        const [path] = await Utils.openFileDialog({ allowedFileTypes: "ts", canChooseFiles: true, canChooseDirectory: false, allowsMultipleSelection: false });
        return path ?? null;
      },
      async selectDirectory() {
        if (process.platform === "darwin") {
          // ACT: macOS 用自带 zh-Hans 本地化的小 .app 弹面板：Electrobun 的 openFileDialog 没有
          // canCreateDirectories（面板里没有「新建文件夹」），osascript 又只有英文包。
          // 失败时直接抛错，不回退到 Electrobun 面板——那是同步 FFI，会把整个应用冻住。
          try {
            const selected = await runMacPicker(["--start", lastFolderPickerDirectory ?? process.env.HOME ?? "/"]);
            if (selected) lastFolderPickerDirectory = selected;
            return selected;
          } finally {
            mainWindow.show();
            mainWindow.activate();
          }
        }
        const [path] = await Utils.openFileDialog({ canChooseFiles: false, canChooseDirectory: true, allowsMultipleSelection: false });
        return path ?? null;
      },
      async ready(failed = false) {
        if (isClosing) return;
        // ACT: 页面脚本已挂载（包括启动失败恢复页），关闭闸门可以安全调用前端 flush。
        pageReady = true;
        if (!isShowing) {
          if (splash) {
            await splash.finish();
            if (isClosing || !splash) return;
            mainWindow.show();
            splash.close();
            splash = undefined;
          }
          isShowing = true;
          // ACT: macOS 在窗口 hidden 期间 maximize 不可靠，等首次 show() 之后再恢复最大化。
          // 用独立的 restoreMaximized 判定，启动期几何事件不会把它提前清掉。
          if (restoreMaximized && !mainWindow.isMaximized()) mainWindow.maximize();
          // ACT: 安装器已完成注册；更新后的修复仅首次展示时执行，不阻塞主窗口。
          void restoreInstallRegistration(installDirectory);
        }
        if (failed && !connection.remote) {
          if (process.platform === "win32") confirmWindowsUpdateStartup(PATHS.RESOURCES_FOLDER, true);
          else await (Updater as DesktopRuntime["updater"]).confirmStartup?.(true);
          deliverInstall = undefined;
          return;
        }
        if (connection.remote) {
          // 远端离线不代表本机更新启动失败；安装协议等回到独立运行后再投递。
          deliverInstall = undefined;
          if (process.platform === "win32") confirmWindowsUpdateStartup(PATHS.RESOURCES_FOLDER);
          else await (Updater as DesktopRuntime["updater"]).confirmStartup?.();
          return;
        }
        deliverInstall = request => {
          mainWindow.unminimize();
          mainWindow.show();
          mainWindow.activate();
          mainWindow.webview.executeJavascript(`window.dispatchEvent(new CustomEvent("toonflow:install-plugin", { detail: ${JSON.stringify(request)} }));`);
        };
        while (pendingInstalls.length) {
          deliverInstall(pendingInstalls[0]!);
          pendingInstalls.shift();
        }
        if (process.platform === "win32") confirmWindowsUpdateStartup(PATHS.RESOURCES_FOLDER);
        else await (Updater as DesktopRuntime["updater"]).confirmStartup?.();
      },
      openDevTools() { mainWindow.webview.openDevTools(); },
      // ACT: Windows 使用两阶段退出；Intel Mac 由兼容入口适配 1.18.1 更新器。
      // 两者都会在重启前申请一次 quit 批准，必须包一层先过关闭闸门，否则更新重启会被 veto。
      updater: withUpdateGate(process.platform === "win32" ? createWindowsUpdater(PATHS.RESOURCES_FOLDER, Utils as unknown as Parameters<typeof createWindowsUpdater>[1]) : Updater),
    } satisfies DesktopRuntime;
    if (process.platform === "win32") {
      // ACT: Electrobun 2.0.1 未设置 Windows 窗口图标，复用构建产物中的应用 ICO。
      const user32 = dlopen("user32.dll", {
        LoadImageW: { args: ["ptr", "ptr", "u32", "i32", "i32", "u32"], returns: "ptr" },
        SendMessageW: { args: ["ptr", "u32", "u64", "ptr"], returns: "ptr" },
        GetDpiForWindow: { args: ["ptr"], returns: "u32" },
        GetSystemMetricsForDpi: { args: ["i32", "u32"], returns: "i32" },
        DestroyIcon: { args: ["ptr"], returns: "i32" },
        GetAsyncKeyState: { args: ["i32"], returns: "i16" },
      });
      const native = user32.symbols;
      isControlHeld = () => Boolean(native.GetAsyncKeyState(0x11) & 0x8000);
      const window = mainWindow.ptr;
      const dpi = native.GetDpiForWindow(window);
      const iconPath = Buffer.from(`${resolve(PATHS.RESOURCES_FOLDER, "app.ico")}\0`, "utf16le");
      // ICON_SMALL / ICON_BIG，各自使用当前窗口 DPI 对应的系统尺寸。
      const icons = [49, 11].map((metric) => native.LoadImageW(
        null, ptr(iconPath), 1, native.GetSystemMetricsForDpi(metric, dpi), native.GetSystemMetricsForDpi(metric + 1, dpi), 0x10,
      ));
      const closeIcons = () => {
        clearTimeout(navigationTimer);
        for (const icon of icons) if (icon) native.DestroyIcon(icon);
        user32.close();
      };
      if (icons.some((icon) => !icon)) {
        closeIcons();
        throw new Error(t`无法加载主窗口图标`);
      }
      icons.forEach((icon, type) => native.SendMessageW(window, 0x80, type, icon));
      mainWindow.on("close", closeIcons);
    }
    mainWindow.on("close", () => {
      // 关闭闸门：先把未提交的 pendingFrame 合并进 normal 并同步写盘（后续关闭流程可复用 flushWindowState）。
      flushWindowState();
      void connection.close().catch(error => console.error("设备连接关闭失败：", error));
      void closeBrowsers().catch(error => console.error("浏览器关闭失败：", error));
      isClosing = true;
      deliverInstall = undefined;
      pendingInstalls.length = 0;
      splash?.close();
      splash = undefined;
    });
    function saveRuntime(port: number) {
      if (process.platform === "win32") {
        // ACT: 切换连接也更新端口；启动器通过 PID 忽略已退出进程留下的记录。
        writeAtomicSync(resolve(PATHS.RESOURCES_FOLDER, "desktopRuntime.json"), JSON.stringify({ pid: process.pid, port }));
      }
    }
    saveRuntime(connection.port);
    function getNavigationRules(port: number) {
      return ["^http://*", "^https://*", `http://127.0.0.1:${port}/*`];
    }
  } catch (error) {
    await desktopConnection?.close().catch(error => console.error("设备连接关闭失败：", error));
    splash?.close();
    console.error("桌面启动失败：", error);
    // ACT: 启动失败没有可保存的页面，直接跳过关闭闸门的 veto，避免 Utils.quit(1) 被拦下。
    forceQuit = true;
    if (process.platform === "win32") {
      try { confirmWindowsUpdateStartup(PATHS.RESOURCES_FOLDER, true); }
      catch (resultError) { console.error("更新启动结果写入失败：", resultError); }
    }
    Utils.quit(1);
  }
}

void start();
