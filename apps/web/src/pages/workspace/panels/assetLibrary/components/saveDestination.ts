import type { AssetLibraryKind, AssetSaveDefaults } from "@/stores/assetLibrary";

/**
 * 解析保存弹窗打开时的「目标库 + 保存位置」。
 *
 * 规则：
 * 1. 有记忆且目标库仍可用：原样回填。
 * 2. 没有记忆：回落到当前浏览库（无项目目录时不能用项目库）。
 * 3. 记忆的目标库不可用（无项目目录却记了项目库）：目标库回落到浏览器库，保存位置一起回落，
 *    不能把项目库的相对路径套到全局库上。
 */
export function resolveSaveDestination(options: {
  defaults?: AssetSaveDefaults;
  /** 当前浏览的库；无记忆时作为目标库回落。 */
  library: AssetLibraryKind;
  directory?: string;
  fallbackPath: string;
}): { library: AssetLibraryKind; path: string } {
  const fallbackLibrary: AssetLibraryKind = options.library === "project" && !options.directory ? "global" : options.library;
  const library = options.defaults?.library ?? fallbackLibrary;
  const target = library === "project" && !options.directory ? fallbackLibrary : library;
  const path = options.defaults && options.defaults.library === target ? options.defaults.path : options.fallbackPath;
  return { library: target, path };
}
