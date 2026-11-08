import { importAsset, toAssetError } from "../assetLibrary/api";
import type { AssetLibraryKind } from "../assetLibrary/types";
import type { PreparedAsset } from "./selectionAssets";

export type SaveSelectionToAssetsResult = {
  saved: number;
  failed: { label: string; reason: string }[];
  renamed: number;
};

// ACT: 与 useAssetUpload 一致；并发 2 足够让写盘与索引刷新重叠，又不会把素材接口拖死。
const concurrency = 2;
const maxAttempts = 3;

function importedName(path: string) {
  return path.split("/").pop() ?? path;
}

function wait(ms: number) {
  return new Promise<void>(resolve => { setTimeout(resolve, ms); });
}

/**
 * 把选中的图片/视频节点批量复制进素材库。
 * 只做复制，不移动也不删除工作区文件，所以源节点文件被清理后素材库里的副本仍然有效。
 * 落点由调用方（批量保存弹窗）确认传入；未传时仍落本项目素材库根目录。
 */
export async function saveSelectionToAssets(
  items: PreparedAsset[],
  directory: string,
  target?: { library: AssetLibraryKind; path: string },
): Promise<SaveSelectionToAssetsResult> {
  const result: SaveSelectionToAssetsResult = { saved: 0, failed: [], renamed: 0 };
  let cursor = 0;

  async function saveOne(item: PreparedAsset) {
    const { label, source, name } = item;
    if (!source) {
      result.failed.push({ label, reason: "没有可导出的图片或视频" });
      return;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // ACT: 走 import 而不是 uploadAsset——源是工作区相对路径，服务端直接复制文件，
        // 不必把整段视频读进浏览器内存再通过 HTTP 传一遍。
        const imported = await importAsset(
          { library: target?.library ?? "project", directory },
          { kind: "workspace", path: source.value.url },
          { ...(target?.path ? { targetDir: target.path } : {}), name },
        );
        // ACT: 重名以服务端自动改名为准（xxx (2).ext），前端只比对返回文件名来统计改名数，
        // 不自己拼序号，避免与服务端的并发写入抢同一个名字。
        if (importedName(imported.path) !== name) result.renamed++;
        result.saved++;
        return;
      } catch (error) {
        const info = toAssetError(error);
        // 服务端会先探测可用名再 COPYFILE_EXCL，只有另一请求恰好抢到同一名字时才会抛 409/EEXIST。
        if (attempt < maxAttempts - 1 && (info.status === 409 || info.code === "EEXIST")) {
          await wait(80 * (attempt + 1));
          continue;
        }
        result.failed.push({ label, reason: info.message || "导入失败" });
        return;
      }
    }
  }

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item) await saveOne(item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}
