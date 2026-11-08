/**
 * ACT: 工作区文件在**本次会话内**的写版本。
 * 同路径原地覆写（首尾帧抽帧就是这种：固定写 assets/<节点id>/frame-first.jpg）时，
 * 只有 URL 本身变化，`<img>` 才会重新请求；否则展示层会一直停在旧图。
 * 跨重启的正确性由缩略图端点的 ETag 协商（no-cache）兜底，这里不需要持久化。
 */

/** 与读取缓存同一口径：统一分隔符、去掉空段与 `.`、忽略大小写。 */
export function normalizeWorkspacePath(path: string) {
  return path.replaceAll("\\", "/").split("/").filter(part => part && part !== ".").join("/").toLowerCase();
}

export function fileVersionKey(directory: string, path: string) {
  return `${normalizeWorkspacePath(directory)}\0${normalizeWorkspacePath(path)}`;
}

const versions = new Map<string, number>();

/** 文件内容可能变了：递增该路径的版本。 */
export function bumpFileVersion(directory: string, path: string) {
  const key = fileVersionKey(directory, path);
  versions.set(key, (versions.get(key) ?? 0) + 1);
}

export function fileVersion(directory: string, path: string) {
  return versions.get(fileVersionKey(directory, path)) ?? 0;
}
