import { lstat, realpath } from "@toonflow/file";
import { dirname, relative, resolve } from "node:path";
import { getAgentHost } from "@/agent/host";
import { getAgentPreferences } from "./preferences";

/** 开发者选项「开放 Agent 全部权限」：每次实时读取设置，切换后无需重启。 */
export function isAgentFullAccess() {
  return getAgentPreferences().fullAccess;
}

function protectedError(message: string) {
  return Object.assign(new Error(message), { status: 403, code: "EPROTECTED" });
}

async function lstatOptional(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

function assertRegularTarget(info: Awaited<ReturnType<typeof lstatOptional>>) {
  if (info?.isSymbolicLink()) throw protectedError("不能通过符号链接读取文件");
  if (info && !info.isFile() && !info.isDirectory()) throw protectedError("只能读取普通文件或目录");
}

function assertNotProjectState(cwd: string, target: string) {
  // ACT: .toonflow 是应用内部状态目录（上次画布等），开放全部权限时也不向 Agent 暴露。
  if (getAgentHost().workspace.isWithin(cwd, target) && relative(cwd, target).split(/[\\/]/)[0]?.toLocaleLowerCase() === ".toonflow") {
    throw protectedError("项目配置目录不可访问");
  }
}

// ACT: 伪文件系统与应用数据目录没有「项目素材」价值，却可能暴露进程环境与供应商密钥，直接拒绝。
const blockedRoots = ["/proc", "/sys", "/dev"];

function assertNotSensitive(target: string) {
  const normalized = target.replaceAll("\\", "/");
  for (const root of blockedRoots) {
    if (normalized === root || normalized.startsWith(`${root}/`)) throw protectedError("该系统目录不可读取");
  }
  const dataDir = dirname(getAgentHost().settings.settingsPath()).replaceAll("\\", "/");
  if (normalized === dataDir || normalized.startsWith(`${dataDir}/`)) throw protectedError("应用数据目录不可读取");
}

/**
 * 解析 Agent 的只读路径。
 * 默认沿用工作区限制；开发者开启全部权限后允许项目外路径（绝对路径直接使用，相对路径仍按 cwd 解析）。
 * 无论是否放开，都拒绝符号链接、特殊文件和项目内 .toonflow 状态目录。
 */
export async function resolveAgentReadPath(cwd: string, path: string) {
  if (path.includes("\0")) throw Object.assign(new Error("文件路径无效"), { status: 400 });
  const absolute = resolve(cwd, path);

  if (!isAgentFullAccess()) {
    const target = (await getAgentHost().workspace.resolveWorkspacePath(cwd, relative(cwd, absolute), true)).path;
    assertRegularTarget(await lstatOptional(target));
    assertNotProjectState(cwd, target);
    return target;
  }

  const info = await lstatOptional(absolute);
  assertRegularTarget(info);
  // ACT: 存在的目标返回真实路径，避免后续读写经由中间符号链接漂移到其他位置。
  const target = info ? await realpath(absolute) : absolute;
  assertNotProjectState(cwd, target);
  assertNotSensitive(target);
  return target;
}
