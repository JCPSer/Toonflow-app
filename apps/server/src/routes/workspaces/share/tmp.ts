import { readdir, rm, stat } from "@toonflow/file";
import { dirname, join } from "node:path";
import u from "@/utils";

/** 拖拽上传的临时包只放这里，导入结束或超过 1 小时后清理。 */
export function temporaryDirectory() {
  return join(dirname(u.conf.path), "tmp");
}

export async function sweepTemporaryShareFiles() {
  const directory = temporaryDirectory();
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("import-")) continue;
    const path = join(directory, entry.name);
    const info = await stat(path).catch(() => null);
    if (info && now - info.mtimeMs > 60 * 60 * 1000) await rm(path).catch(() => {});
  }
}
