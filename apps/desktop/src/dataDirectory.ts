import { appendFile, lstat, mkdir, rename, stat } from "@toonflow/file";
import { resolve } from "node:path";

// ACT: 目录名必须能一眼看出归属，通用的 data 会和同目录其它软件撞名、被清理工具误删。
export const dataDirectoryName = "toonflow-data";
export const legacyDataDirectoryName = "data";

type Entry =
  | { kind: "missing" }
  | { kind: "directory"; link: boolean }
  | { kind: "file" }
  | { kind: "error"; error: unknown };

async function isDirectoryFollowingLinks(path: string) {
  const info = await stat(path).catch(() => undefined);
  return !!info?.isDirectory();
}

// ACT: 只把 ENOENT 当作「不存在」；EACCES 之类必须显式暴露，否则会静默新建空目录、看起来像配置丢失。
async function inspect(path: string): Promise<Entry> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? { kind: "missing" } : { kind: "error", error };
  }
  if (info.isSymbolicLink()) {
    // 符号链接按目标判断：指向目录说明用户把数据目录重定向到了别处，尊重该意图，不再改名。
    return { kind: (await isDirectoryFollowingLinks(path)) ? "directory" : "file", link: true };
  }
  return { kind: info.isDirectory() ? "directory" : "file", link: false };
}

// ACT: 打包版从 Finder 启动时没有终端，console 输出看不到；迁移结论必须落到数据目录里才可追查。
// 只写已知的数据目录，绝不往安装根目录（/Applications）新建通用名目录。
const logMaxBytes = 256 * 1024;
async function note(directory: string | undefined, message: string, detail?: unknown) {
  if (!directory) return;
  const text = detail === undefined ? message : `${message}：${detail instanceof Error ? detail.message : String(detail)}`;
  try {
    const folder = resolve(directory, "logs");
    const file = resolve(folder, "desktop.log");
    await mkdir(folder, { recursive: true });
    const info = await stat(file).catch(() => undefined);
    // 共存与链接分支每次启动都会追加，单文件超过上限就轮转一份。
    if (info && info.size > logMaxBytes) await rename(file, `${file}.1`).catch(() => {});
    await appendFile(file, `${new Date().toISOString()} ${text}\n`);
  } catch { /* 记录失败不影响启动 */ }
}

/**
 * 解析桌面端数据目录；存量安装会把旧的 data 原子改名为 toonflow-data。
 * 改名失败、旧目录是重定向链接、或状态读取失败时都继续使用旧目录：
 * 宁可名字没改成，也不能让应用起不来或让用户以为配置丢了。
 */
export async function resolveDesktopDataDirectory(installDirectory: string) {
  const overlay = process.env.TOONFLOW_DATA_DIR;
  // ACT: 返回值统一是绝对路径，相对的环境变量按进程工作目录解析，避免下游各自 resolve。
  if (overlay) return resolve(overlay);
  const target = resolve(installDirectory, dataDirectoryName);
  const legacy = resolve(installDirectory, legacyDataDirectoryName);
  const targetEntry = await inspect(target);
  const legacyEntry = await inspect(legacy);
  if (targetEntry.kind === "directory") {
    if (legacyEntry.kind === "directory") {
      console.warn(`旧数据目录 ${legacy} 与 ${target} 同时存在，本次使用 ${target}；旧目录未合并`);
      await note(target, "旧数据目录未合并，仍在使用新目录", legacy);
    }
    return target;
  }
  if (targetEntry.kind === "error") {
    console.error(`读取数据目录 ${target} 失败：`, targetEntry.error);
    if (legacyEntry.kind === "directory") await note(legacy, "读取新数据目录失败", targetEntry.error);
    return legacyEntry.kind === "directory" ? legacy : target;
  }
  if (legacyEntry.kind === "error") {
    console.error(`读取数据目录 ${legacy} 失败，保持原状：`, legacyEntry.error);
    return legacy;
  }
  if (legacyEntry.kind !== "directory") return target;
  // 目标被同名文件占着时无法改名，服务端也无法在那里建目录：继续用旧目录而不是让启动失败。
  if (targetEntry.kind === "file") {
    console.error(`${target} 已被文件占用，继续使用 ${legacy}`);
    await note(legacy, "新数据目录被文件占用，继续使用旧目录", target);
    return legacy;
  }
  if (legacyEntry.link) {
    console.warn(`数据目录 ${legacy} 是符号链接，按现有重定向继续使用，不做改名`);
    await note(legacy, "数据目录是符号链接，按现有重定向继续使用");
    return legacy;
  }
  try {
    await rename(legacy, target);
    console.log(`数据目录已迁移：${legacy} → ${target}`);
    await note(target, `数据目录已迁移：${legacy} → ${target}`);
    return target;
  } catch (error) {
    // 双开时另一实例可能已完成迁移，此时旧路径已不存在，不能再回退过去。
    if (await isDirectoryFollowingLinks(target)) {
      await note(target, "另一实例已完成数据目录迁移，跟随新目录");
      return target;
    }
    console.error(`数据目录迁移失败，继续使用 ${legacy}：`, error);
    await note(legacy, "数据目录迁移失败，继续使用旧目录", error);
    return legacy;
  }
}
