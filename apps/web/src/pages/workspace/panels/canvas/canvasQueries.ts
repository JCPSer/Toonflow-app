import { canvasSchemas, type CanvasToolCall } from "@toonflow/tool-canvas/runtime";
import type { NodeToolsContext } from "@toonflow/tools-scaffold/runtime";

type CanvasNode = { id: string; type?: string; label?: unknown; position: { x: number; y: number }; selected?: boolean; data: Record<string, unknown> };
type CanvasEdge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
type ValueOptions = { textOffset: number; textLimit: number; valueOffset: number; valueLimit: number };
type OmittedValue = { path: string[]; reason: string; total?: number; nextOffset?: number };
const encoder = new TextEncoder();
const responseBytes = 64 * 1024;
const pageBytes = 52 * 1024;
const scanLimit = 2000;
const readNames = new Set(["getCanvas", "findCanvasNodes", "getCanvasNodes", "getCanvasEdges", "getNodeTools"]);

export function isCanvasRead(name: string) {
  return readNames.has(name);
}

function jsonSize(value: unknown, limit = responseBytes) {
  let remaining = limit;
  const ancestors = new Set<object>();
  function measure(value: unknown, depth: number) {
    if (remaining < 0) return;
    if (typeof value === "string") {
      if (value.length > remaining) { remaining = -1; return; }
      remaining -= encoder.encode(JSON.stringify(value)).length;
    } else if (value === null || typeof value !== "object") {
      remaining -= (JSON.stringify(value) ?? "null").length;
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (depth > 64 || ancestors.has(value) || typeof Reflect.get(value, "toJSON") === "function"
        || (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)) { remaining = -1; return; }
      ancestors.add(value);
      remaining -= 2;
      let count = 0;
      if (Array.isArray(value)) {
        if (value.length > remaining) remaining = -1;
        else for (let index = 0; index < value.length && remaining >= 0; index++) {
          if (index) remaining--;
          measure(value[index], depth + 1);
        }
      } else {
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          const entry = Reflect.get(value, key);
          if (entry === undefined || typeof entry === "function") continue;
          if (count++) remaining--;
          measure(key, depth + 1);
          remaining--;
          measure(entry, depth + 1);
          if (remaining < 0) break;
        }
      }
      ancestors.delete(value);
    }
  }
  measure(value, 0);
  return limit - remaining;
}

// ACT: 投影只遍历有界的字段和字符串，不调用节点自定义 toJSON，也不复制整幅画布。
function projectValue(value: unknown, options: ValueOptions, path: string[] = []) {
  const truncated: OmittedValue[] = [];
  let remaining = 36 * 1024;
  let visited = 0;
  const ancestors = new Set<object>();
  function omit(path: string[], reason: string, extra: Partial<OmittedValue> = {}) {
    const entry = { path, reason, ...extra };
    truncated.push(entry);
    remaining -= jsonSize(entry) + 1;
    return null;
  }
  function copy(value: unknown, path: string[], depth: number): unknown {
    if (jsonSize(path, 2048) > 2048) return omit(path.slice(0, -1), "pathBytesLimit");
    const reserve = jsonSize(path) + 1024;
    if (remaining < reserve || ++visited > 256) return omit(path, "budget");
    if (typeof value === "string") {
      const offset = options.textOffset;
      const end = Math.min(value.length, offset + options.textLimit, offset + Math.floor((remaining - reserve) / 6));
      const text = value.slice(offset, end);
      remaining -= jsonSize(text);
      if (offset > 0 || end < value.length) omit(path, "text", { total: value.length, ...(end < value.length ? { nextOffset: end } : {}) });
      return text;
    }
    if (value === null || typeof value === "number" || typeof value === "boolean") { remaining -= 32; return value; }
    if (typeof value !== "object") return null;
    if (path.length >= 64) return omit(path, "pathDepthLimit");
    if (depth >= 6) return omit(path, "depth");
    if (ancestors.has(value)) return omit(path, "circular");
    ancestors.add(value);
    const offset = depth === 0 ? options.valueOffset : 0;
    const result: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : Object.create(null);
    let count = 0;
    if (Array.isArray(value)) {
      for (let index = offset; index < value.length; index++) {
        if (count >= options.valueLimit || remaining < reserve || visited >= 256) {
          omit(path, "entries", { total: value.length, nextOffset: index });
          break;
        }
        (result as unknown[]).push(copy(value[index], [...path, String(index)], depth + 1));
        count++;
      }
      if (offset > 0 && offset + count >= value.length) omit(path, "entries", { total: value.length });
    } else {
      let index = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (index++ < offset) continue;
        if (count >= options.valueLimit || remaining < reserve || visited >= 256) {
          omit(path, "entries", { nextOffset: index - 1 });
          break;
        }
        if (key.length > 256) { omit(path, "keyTooLong", { nextOffset: index }); break; }
        remaining -= jsonSize(key) + 2;
        (result as Record<string, unknown>)[key] = copy(Reflect.get(value, key), [...path, key], depth + 1);
        count++;
      }
      if (offset > 0 && !truncated.some(item => item.path === path)) omit(path, "entries");
    }
    ancestors.delete(value);
    return result;
  }
  return { value: copy(value, path, 0), truncated };
}

export function canvasNodeSummary(node: CanvasNode) {
  const label = typeof node.data.label === "string" ? node.data.label : typeof node.label === "string" ? node.label : node.id;
  return { id: node.id, type: node.type, label: label.slice(0, 512), ...(label.length > 512 ? { labelTruncated: true } : {}), selected: !!node.selected };
}

export function canvasEdgeSummary(edge: CanvasEdge) {
  return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle };
}

// ACT: 禁用节点对 Agent 不可见；data 来自画布 JSON，运行时可能缺字段，统一按 === true 判定。
export function isDisabledNode(node: CanvasNode) {
  return node.data?.disabled === true;
}

// ACT: 禁用集合必须进入分页游标——节点数不变但禁用状态变化时，按旧 offset 翻页会跳过或重复条目。
// 用顺序相关的短哈希（FNV-1a），避免长画布的 0/1 串把游标撑过 4096 字节上限。
function disabledSignature(nodes: readonly CanvasNode[]) {
  let hash = 0x811c9dc5;
  let disabled = 0;
  for (const node of nodes) {
    const bit = isDisabledNode(node) ? 1 : 0;
    disabled += bit;
    hash = Math.imul(hash ^ bit, 0x01000193);
  }
  return `${nodes.length}.${disabled}.${(hash >>> 0).toString(36)}`;
}

export function createCanvasQueries(source: {
  nodes(): readonly CanvasNode[];
  edges(): readonly CanvasEdge[];
  findNode(id: string): CanvasNode | undefined;
  viewport(): { x: number; y: number; zoom: number };
  nodeRevision(): number;
  edgeRevision(): number;
  canvases(signal?: AbortSignal): Promise<{ id: string; name: string }[]>;
  nodeTypes(): { type: string; label: string }[];
  nodeTools(): NodeToolsContext;
}) {
  const sessionId = crypto.randomUUID();
  // ACT: 按 ID 的读工具统一走这里；禁用节点一律抛错，扫描类自行过滤、不走该断言。
  function findNode(id: string) {
    const node = source.findNode(id);
    if (!node) throw new Error(`节点不存在：${id}`);
    if (isDisabledNode(node)) throw new Error(`节点已禁用：${id}`);
    return node;
  }

  return async function read(request: CanvasToolCall, canvasId: string, signal: AbortSignal) {
    if (!isCanvasRead(request.name)) throw new Error("未知画布查询");
    const name = request.name as "getCanvas" | "findCanvasNodes" | "getCanvasNodes" | "getCanvasEdges" | "getNodeTools";
    const args = canvasSchemas[name].parse(request.args);
    if (args.canvasId !== undefined && args.canvasId !== canvasId) throw new Error("目标画布已切换，请重新查询画布");
    const { cursor, ...filters } = args;
    const metadata = name === "getCanvas" ? {
      canvases: (args as { include?: string[] }).include?.includes("canvases") ? await source.canvases(signal) : [],
      types: (args as { include?: string[] }).include?.includes("nodeTypes") ? source.nodeTypes() : [],
    } : undefined;
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([name, filters, metadata])));
    signal.throwIfAborted();
    const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    // ACT: 分页 cursor 必须随禁用集合失效；getCanvas 分页的是画布/类型清单，与节点无关，不纳入签名。
    const disabled = disabledSignature(source.nodes());
    const revision = name === "getCanvasEdges" ? `${source.edgeRevision()}:${disabled}`
      : name === "getNodeTools" ? `${source.nodeRevision()}:${source.nodeTools().version}:${disabled}`
        : name === "findCanvasNodes" ? `${source.nodeRevision()}:${disabled}`
          : source.nodeRevision();
    let offset = 0;
    if (cursor) {
      let page: unknown;
      try { page = JSON.parse(cursor); } catch { throw new Error("分页游标无效，请重新查询"); }
      if (!Array.isArray(page) || page.length !== 6 || page[0] !== sessionId || page[1] !== canvasId || page[2] !== revision || page[3] !== key || !Number.isSafeInteger(page[4]) || page[4] < 0 || page[5] !== name) {
        throw new Error("画布结构或查询参数已变化，分页游标失效，请重新查询");
      }
      offset = page[4];
    }
    const items: unknown[] = [];
    let bytes = 0;
    function append(value: unknown) {
      const size = jsonSize(value) + 1;
      if (bytes + size > pageBytes) {
        if (!items.length) throw new Error("单项结果超过读取预算，请缩小 fields、dataKeys、names 或 textLimit；函数参数定义不会截断");
        return false;
      }
      bytes += size;
      items.push(value);
      return true;
    }
    function finish(field: string, hasMore: boolean, extra: Record<string, unknown> = {}) {
      const result = { canvasId, ...(field ? { [field]: items } : {}), ...extra, hasMore, nextCursor: hasMore ? JSON.stringify([sessionId, canvasId, revision, key, offset, name]) : null };
      if (jsonSize(result) > responseBytes) throw new Error("读取结果超过 64 KiB，请缩小查询范围");
      return result;
    }

    switch (name) {
      case "getCanvas": {
        const args = canvasSchemas.getCanvas.parse(request.args);
        const canvases = metadata!.canvases;
        const types = metadata!.types;
        const total = Math.max(canvases.length, types.length);
        const canvasItems: unknown[] = [];
        const typeItems: unknown[] = [];
        while (offset < total && items.length < args.limit) {
          const canvas = canvases[offset];
          const type = types[offset];
          const pair = { ...(canvas ? { canvas } : {}), ...(type ? { type } : {}) };
          if (!append(pair)) break;
          if (canvas) canvasItems.push(canvas);
          if (type) typeItems.push(type);
          offset++;
        }
        // ACT: 概览计数一律剔除禁用节点与触边，否则 Agent 能凭数量差反推被隐藏的内容。
        const enabledNodes = source.nodes().filter(node => !isDisabledNode(node));
        const enabledIds = new Set(enabledNodes.map(node => node.id));
        const edgeCount = source.edges().filter(edge => enabledIds.has(edge.source) && enabledIds.has(edge.target)).length;
        return finish("", offset < total, {
          id: canvasId, nodeCount: enabledNodes.length, edgeCount,
          selectedCount: enabledNodes.filter(node => node.selected).length, viewport: { ...source.viewport() },
          ...(args.include?.includes("canvases") ? { canvases: canvasItems, canvasCount: canvases.length } : {}),
          ...(args.include?.includes("nodeTypes") ? { availableNodeTypes: typeItems, nodeTypeCount: types.length } : {}),
        });
      }
      case "findCanvasNodes": {
        const args = canvasSchemas.findCanvasNodes.parse(request.args);
        // ACT: 扫描类静默跳过禁用节点；offset 基于过滤后的数组，totalNodes/scanned 也只统计可见节点。
        const nodes = source.nodes().filter(node => !isDisabledNode(node));
        const keyword = args.query?.trim().toLocaleLowerCase();
        const types = args.types?.length ? new Set(args.types) : undefined;
        const start = offset;
        // ACT: ID 读取复用原生索引；关键词检索按 2000 条分段扫描，频繁全图检索时再维护名称索引。
        while (offset < nodes.length && offset - start < scanLimit && items.length < args.limit) {
          const node = nodes[offset]!;
          const summary = canvasNodeSummary(node);
          const label = typeof node.data.label === "string" ? node.data.label : typeof node.label === "string" ? node.label : node.id;
          if ((!types || types.has(node.type ?? "")) && (!args.selectedOnly || node.selected) && (!keyword || `${node.id} ${label}`.toLocaleLowerCase().includes(keyword))) {
            if (!append(summary)) break;
          }
          offset++;
        }
        return finish("nodes", offset < nodes.length, { scanned: offset - start, totalNodes: nodes.length });
      }
      case "getCanvasNodes": {
        const args = canvasSchemas.getCanvasNodes.parse(request.args);
        const ids = [...new Set(args.nodeIds)];
        while (offset < ids.length) {
          const node = findNode(ids[offset]!);
          const summary = canvasNodeSummary(node);
          const fields: Record<string, unknown> = {
            label: typeof node.data.label === "string" ? node.data.label : node.label ?? node.id,
            type: node.type, position: { x: node.position.x, y: node.position.y },
            ports: node.data.handles ?? [], outputs: node.data.outputs ?? {}, data: node.data,
          };
          let projected: unknown;
          let path: string[] = [];
          if (args.path) {
            path = args.path;
            projected = fields;
            for (const part of path) {
              if (!projected || typeof projected !== "object" || !Object.hasOwn(projected, part)) throw new Error(`节点 ${node.id} 不存在路径 ${path.join(".")}`);
              projected = Reflect.get(projected, part);
            }
            if (args.textOffset > 0 && typeof projected !== "string") throw new Error("textOffset 仅用于字符串路径");
            if (args.valueOffset > 0 && (!projected || typeof projected !== "object")) throw new Error("valueOffset 仅用于数组或对象路径");
          } else {
            projected = Object.create(null);
            for (const field of args.fields) {
              (projected as Record<string, unknown>)[field] = field === "data" && args.dataKeys
                ? Object.fromEntries(args.dataKeys.filter(key => Object.hasOwn(node.data, key)).map(key => [key, node.data[key]])) : fields[field];
            }
          }
          const preview = projectValue(projected, args, path);
          if (!args.path) {
            preview.truncated = preview.truncated.flatMap(item => item.path.length ? [item]
              : args.fields.slice(item.nextOffset ?? 0).map(field => ({ path: [field], reason: "budget" })));
          }
          const value = args.path ? { id: node.id, path, value: preview.value, truncated: preview.truncated }
            : { id: node.id, ...(preview.value as object), selected: summary.selected, truncated: preview.truncated };
          if (!append(value)) break;
          offset++;
        }
        return finish("nodes", offset < ids.length);
      }
      case "getCanvasEdges": {
        const args = canvasSchemas.getCanvasEdges.parse(request.args);
        const ids = args.nodeIds ? new Set(args.nodeIds) : undefined;
        // ACT: 显式 nodeIds 走统一断言（命中禁用即抛错）；不带 nodeIds 时静默过滤触边。
        ids?.forEach(findNode);
        // ACT: 边的两端 ID 会进回执，因此触到禁用节点的边一律不返回，否则等于泄露被隐藏的节点。
        const enabledIds = new Set(source.nodes().filter(node => !isDisabledNode(node)).map(node => node.id));
        const edges = source.edges().filter(edge => enabledIds.has(edge.source) && enabledIds.has(edge.target));
        const start = offset;
        while (offset < edges.length && offset - start < scanLimit && items.length < args.limit) {
          const edge = edges[offset]!;
          if (!ids || (args.direction !== "incoming" && ids.has(edge.source)) || (args.direction !== "outgoing" && ids.has(edge.target))) {
            if (!append(canvasEdgeSummary(edge))) break;
          }
          offset++;
        }
        return finish("edges", offset < edges.length, { scanned: offset - start, totalEdges: edges.length });
      }
      case "getNodeTools": {
        const args = canvasSchemas.getNodeTools.parse(request.args);
        args.nodeIds.forEach(findNode);
        let index = 0;
        for (const tool of source.nodeTools().list(args.nodeIds, args.names)) {
          if (index++ < offset) continue;
          if (items.length >= args.limit || !append(tool)) return finish("nodeTools", true);
          offset++;
        }
        return finish("nodeTools", false);
      }
    }
  };
}
