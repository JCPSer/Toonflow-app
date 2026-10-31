/**
 * 工程分享包的画布处理：历史字段清理、引用收集、文本插图解析、压缩换格式后的路径改写。
 *
 * 全部是纯函数（不碰磁盘、不改入参），容器层与编排层只依赖这里的导出。
 */

/** 工作区相对路径的前缀；单段路径（`assets/foo.png`）也算命中。 */
const WORKSPACE_PATH_PATTERN = /^(?:assets|library|library-assets)\//;

/** markdown 图片：`![alt](url "title")`，允许尖括号包裹带空格的路径。 */
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

/** HTML 图片：`<img src="...">`；`(?<![\w-])` 避免命中 `data-src` / `xsrc`。 */
const HTML_IMAGE_PATTERN = /<img\b[^>]*?(?<![\w-])src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** 只拷贝 JSON 结构；画布本来就是 JSON，因此不引入 structuredClone 的运行时依赖。 */
function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = cloneJson(item);
    return copy as T;
  }
  return value;
}

/** 统一分隔符并去掉前导 `./`。 */
function normalizeRelativePath(value: string): string {
  let path = value.replace(/\\/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  return path;
}

/** 不含 scheme、不是绝对路径的相对路径。 */
function isRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("//")) return false;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path);
}

/** 递归访问所有字符串值。 */
function visitStrings(value: unknown, visit: (value: string) => void, seen = new Set<unknown>()): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitStrings(item, visit, seen);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  for (const item of Object.values(value)) visitStrings(item, visit, seen);
}

/** 原地替换所有字符串值（入参必须是 cloneJson 出来的副本）。 */
function mapStrings(value: unknown, replace: (value: string) => string, seen = new Set<unknown>()): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const item = value[index];
      if (typeof item === "string") value[index] = replace(item);
      else mapStrings(item, replace, seen);
    }
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (typeof item === "string") value[key] = replace(item);
    else mapStrings(item, replace, seen);
  }
}

/** 递归访问所有对象（用于定位 `outputs`，数组也算容器）。 */
function visitRecords(value: unknown, visit: (record: Record<string, unknown>) => void, seen = new Set<unknown>()): void {
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, visit, seen);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  visit(value);
  for (const item of Object.values(value)) visitRecords(item, visit, seen);
}

function dropOwn(record: Record<string, unknown>, key: string, path: string, dropped: string[]): void {
  if (!hasOwn(record, key)) return;
  delete record[key];
  dropped.push(path);
}

/**
 * 深拷贝画布并删除「历史可回退」字段。
 *
 * `inpaint` 必须整个删——`source/original/guide/mask/images` 缺一个，生成时会抛「局部重绘素材无效」。
 * `crop.last`、文本正文指针、模型路径、拉片结果与所有 outputs 都保留。
 */
export function sanitizeCanvas(canvas: unknown): { canvas: any; dropped: string[] } {
  const copy = cloneJson(canvas);
  const dropped: string[] = [];
  if (!isRecord(copy) || !Array.isArray(copy.nodes)) return { canvas: copy, dropped };

  copy.nodes.forEach((node, index) => {
    if (!isRecord(node) || !isRecord(node.data)) return;
    const data = node.data;
    const prefix = `nodes[${index}].data`;

    dropOwn(data, "agentSessionFile", `${prefix}.agentSessionFile`, dropped);
    dropOwn(data, "agentSessionCloneFrom", `${prefix}.agentSessionCloneFrom`, dropped);

    if (isRecord(data.crop)) {
      dropOwn(data.crop, "previous", `${prefix}.crop.previous`, dropped);
      dropOwn(data.crop, "appliedUrl", `${prefix}.crop.appliedUrl`, dropped);
    }
    if (isRecord(data.scale)) {
      dropOwn(data.scale, "previous", `${prefix}.scale.previous`, dropped);
      dropOwn(data.scale, "appliedUrl", `${prefix}.scale.appliedUrl`, dropped);
    }

    // ACT: 不逐字段删 inpaint，越删越坏。
    dropOwn(data, "inpaint", `${prefix}.inpaint`, dropped);
  });

  return { canvas: copy, dropped };
}

/**
 * 递归扫描画布 JSON 里的所有字符串值，收集工作区相对路径。
 *
 * 不按字段名枚举：拉片 `lastResult.manifest`、`inpaint.images[].path` 这类差集字段
 * 靠递归兜底，漏一个字段就漏一个文件。
 */
export function referencedPaths(canvas: unknown): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  visitStrings(canvas, (value) => {
    const path = normalizeRelativePath(value);
    if (!WORKSPACE_PATH_PATTERN.test(path) || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  });
  return paths;
}

/**
 * 抓取文本节点正文里的原始图片引用串（`![alt](src)` 与 `<img src>`）。
 *
 * 只做语法层面的去壳（尖括号、首尾空白），不做路径规范化，也不按 scheme 过滤——
 * 引用是否可用由 `resolveMarkdownPath` 相对正文路径判定。返回按出现顺序去重。
 */
export function markdownImageSources(content: string): string[] {
  if (typeof content !== "string" || !content) return [];
  const sources: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    if (raw === undefined) return;
    const source = raw.trim().replace(/^<|>$/g, "");
    if (!source || seen.has(source)) return;
    seen.add(source);
    sources.push(source);
  };

  for (const match of content.matchAll(MARKDOWN_IMAGE_PATTERN)) push(match[1]);
  for (const match of content.matchAll(HTML_IMAGE_PATTERN)) push(match[1] ?? match[2] ?? match[3]);
  return sources;
}

/**
 * 解析文本节点正文里的 markdown / HTML 图片引用；只返回不含 scheme 的相对路径。
 *
 * 注意：这些路径是按「正文文件所在目录」写的，不等于工作区相对路径。
 * 要落盘收集请用 `markdownImageSources` + `resolveMarkdownPath(source, textPath)`。
 */
export function markdownImagePaths(content: string): string[] {
  const paths: string[] = [];
  for (const source of markdownImageSources(content)) {
    const path = normalizeRelativePath(source);
    if (!isRelativePath(path) || paths.includes(path)) continue;
    paths.push(path);
  }
  return paths;
}

/**
 * 把正文里的图片引用解析成工作区相对路径，返回 null 表示引用非法。
 *
 * 与前端 `packages/nodes/textNode/src/markdownContent.ts:22-36` 的 `resolveMarkdownPath`
 * 逐条对齐：跳过 `http(s):` / `mailto:` / `#`；拒绝带 scheme 或绝对路径；
 * 按 `?`/`#` 截断后 `decodeURIComponent`（前端即先 split 再 decode），`\` 统一为 `/`；
 * 从 `documentPath` 去掉最后一段作为起点逐段解析，`.` 跳过、`..` 出栈，越出工作区即非法。
 * 前端此处会抛错，服务端用于筛选收集，统一降级为返回 null。
 */
export function resolveMarkdownPath(source: string, documentPath = ""): string | null {
  if (/^(?:https?:|mailto:|#)/i.test(source)) return null;
  if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(source)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(source.split(/[?#]/)[0]!);
  } catch {
    return null;
  }
  const path = decoded.replace(/\\/g, "/");
  if (!path || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path) || path.includes("\0")) return null;

  const parts = documentPath.replace(/\\/g, "/").split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/**
 * 换格式时批量改写画布里的路径与 mimeType。
 *
 * 只替换「完全等于」旧路径的字符串值，不做子串替换（`a/b.png` 不会误伤 `xa/b.png`）。
 * 旧路径出现在 `outputs[handle].value.url` 时，同步改写同一个 value 的 `mimeType`。
 *
 * @returns `changed` 为实际被改写到的旧路径（去重，按出现顺序），供日志统计。
 */
export function rewriteMediaPaths(
  canvas: unknown,
  mapping: Map<string, { path: string; mimeType?: string }>,
): { canvas: any; changed: string[] } {
  const copy = cloneJson(canvas);
  const changed: string[] = [];
  const markChanged = (path: string) => {
    if (!changed.includes(path)) changed.push(path);
  };
  if (mapping.size === 0) return { canvas: copy, changed };

  // 先改 mimeType：此时 url 仍是旧路径，可以直接按 mapping key 匹配。
  visitRecords(copy, (record) => {
    if (!isRecord(record.outputs)) return;
    for (const output of Object.values(record.outputs)) {
      if (!isRecord(output) || !isRecord(output.value)) continue;
      const value = output.value;
      if (typeof value.url !== "string") continue;
      const target = mapping.get(value.url);
      if (!target?.mimeType || value.mimeType === target.mimeType) continue;
      value.mimeType = target.mimeType;
      markChanged(value.url);
    }
  });

  mapStrings(copy, (value) => {
    const target = mapping.get(value);
    if (!target || target.path === value) return value;
    markChanged(value);
    return target.path;
  });

  return { canvas: copy, changed };
}
