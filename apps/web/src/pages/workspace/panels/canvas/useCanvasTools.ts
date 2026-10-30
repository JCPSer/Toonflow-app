import { nextTick, watch, type Ref } from "vue";
import { useVueFlow, type XYPosition } from "@vue-flow/core";
import { revealNodeInViewport, useNodeEvent, useNodeToolsContext, validateConnection } from "@toonflow/nodes-scaffold/runtime";
import { canvasSchemas, type CanvasContext, type CanvasToolCall } from "@toonflow/tool-canvas/runtime";
import { asrRequestSchema } from "@toonflow/tools-scaffold/runtime";
import { isBrowserAudioAsrSupported, transcribeBrowserAudio } from "@toonflow/asr";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import { useWorkspaceStore } from "@/stores/workspace";
import { arrangeCanvas } from "./arrangeCanvas";
import { canvasEdgeSummary, canvasNodeSummary, createCanvasQueries, isCanvasRead } from "./canvasQueries";

export function useCanvasTools(options: {
  availableNodes: Ref<{ type: string; label: string }[]>;
  flushSave(): Promise<void>;
  menu(): {
    getCanvases(signal?: AbortSignal): Promise<{ id: string; name: string }[]>;
    peekCanvases(): { id: string; name: string }[];
    addCanvas(name?: string, signal?: AbortSignal): Promise<string>;
    switchCanvas(canvasId: string, signal?: AbortSignal): Promise<void>;
    renameCanvas(canvasId: string, name: string, signal?: AbortSignal): Promise<void>;
  };
  getCanvasBinding(): { id: string; signal: AbortSignal };
  resolveCanvasContext?(id: string): CanvasContext | undefined;
}) {
  const flow = useVueFlow();
  const workspaceStore = useWorkspaceStore();
  const getNodeTools = useNodeToolsContext();
  let nodeRevision = 0;
  let edgeRevision = 0;
  // ACT: 只跟踪显式结构签名，不深读节点 data（deep:1 追不到 data.disabled）；禁用/解除后分页游标必须失效。
  watch(() => flow.nodes.value.map(node => `${node.id}:${node.data?.disabled === true ? 1 : 0}`).join("|"), () => nodeRevision++);
  watch(() => flow.edges.value.map(edge => edge.id).join("|"), () => edgeRevision++);
  // ACT: 同 id 整体替换（setNodes/撤销恢复）时上面的签名不变，但节点对象已换，旧 cursor 不能再放行。
  watch(() => flow.nodes.value, () => nodeRevision++, { flush: "post" });
  watch(() => flow.edges.value, () => edgeRevision++, { flush: "post" });
  const readCanvas = createCanvasQueries({
    nodes: () => flow.nodes.value,
    edges: () => flow.edges.value,
    findNode: flow.findNode,
    viewport: () => flow.viewport.value,
    nodeRevision: () => nodeRevision,
    edgeRevision: () => edgeRevision,
    canvases: signal => options.menu().getCanvases(signal),
    nodeTypes: () => options.availableNodes.value,
    nodeTools: getNodeTools,
  });

  // ACT: 按 ID 的读写工具统一走这里；禁用节点一律抛错。扫描/回执类自行过滤，不走该断言。
  function findNode(nodeId: string) {
    const node = flow.findNode(nodeId);
    if (!node) throw new Error(`节点不存在：${nodeId}`);
    if (node.data?.disabled === true) throw new Error(`节点已禁用：${nodeId}`);
    return node;
  }

  function isNodeDisabled(nodeId: string) {
    return flow.findNode(nodeId)?.data?.disabled === true;
  }

  function nodeInfo(nodeId: string) {
    const node = findNode(nodeId);
    return { node: { ...canvasNodeSummary(node), position: { x: node.position.x, y: node.position.y } } };
  }

  function nodePosition(position: XYPosition) {
    if (!flow.snapToGrid.value) return position;
    const [x, y] = flow.snapGrid.value;
    return { x: Math.round(position.x / x) * x, y: Math.round(position.y / y) * y };
  }

  // ACT: 新节点按画布坐标落位，而用户常常停在画布另一头，结果节点生成在屏幕外要到处找。
  // 一次 AI 调用往往连续建多个节点，逐次平移会互相打断、还会读到动画中途的 viewport，
  // 所以这里攒成一批，等安静下来只按最后一个节点判断并平移一次。
  let pendingReveal: string | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleReveal(nodeId: string) {
    pendingReveal = nodeId;
    if (revealTimer !== undefined) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      revealTimer = undefined;
      const id = pendingReveal;
      pendingReveal = undefined;
      if (id) void revealNodeInViewport(flow, id, { margin: 32 });
    }, 320);
  }

  return (id: string, canvasSignal: AbortSignal, workspaceSignal: AbortSignal): CanvasContext => {
    let redirected: CanvasContext | undefined;
    return {
      get id() { return redirected?.id ?? options.getCanvasBinding().id; },
      // 函数定义通过 getNodeTools 按需发现，初始化消息不携带节点清单。
      tools: [],
      getNodeLabel(nodeId) {
        if (redirected) return redirected.getNodeLabel?.(nodeId);
        const node = flow.findNode(nodeId);
        const label = node?.data.label ?? node?.label;
        return typeof label === "string" && label.trim() ? label : undefined;
      },
      async call(request, signal) {
        if (redirected) return redirected.call(request, signal);
        canvasSignal.throwIfAborted();
        id = options.getCanvasBinding().id;
        const changesCanvas = request.name === "addCanvas" || request.name === "switchCanvas" || request.name === "renameCanvas";
        // ACT: 转写按音频时长运行，复用 ASR 的停滞与收尾超时，不套用画布操作的总时限。
        const callSignal = AbortSignal.any([workspaceSignal, ...(changesCanvas ? [] : [canvasSignal]), ...(request.name === "transcribeAudio" ? [] : [AbortSignal.timeout(120000)]), ...(signal ? [signal] : [])]);
        callSignal.throwIfAborted();
        let cancel = () => {};
        try {
          return await Promise.race([
            Promise.resolve().then(async () => {
              canvasSignal.throwIfAborted();
              let result = await execute(request, callSignal, id);
              callSignal.throwIfAborted();
              if (changesCanvas) {
                const nextContext = options.resolveCanvasContext?.(String(result));
                if (nextContext) {
                  redirected = nextContext;
                  return nextContext.call({ name: "getCanvas", args: {} }, callSignal);
                }
                const binding = options.getCanvasBinding();
                if (binding.id !== result) throw new Error("画布已再次切换，请重新发送消息");
                binding.signal.throwIfAborted();
                id = binding.id;
                canvasSignal = binding.signal;
                result = await execute({ name: "getCanvas", args: {} }, callSignal, id);
              }
              if (!isCanvasRead(request.name) && request.name !== "selectNodes" && request.name !== "transcribeAudio") await options.flushSave();
              callSignal.throwIfAborted();
              canvasSignal.throwIfAborted();
              return result;
            }),
            new Promise<never>((_resolve, reject) => {
              cancel = () => reject(callSignal.reason);
              callSignal.addEventListener("abort", cancel, { once: true });
            }),
          ]);
        } finally {
          callSignal.removeEventListener("abort", cancel);
        }
      },
      };
  };

  async function execute(request: CanvasToolCall, signal: AbortSignal, canvasId: string): Promise<unknown> {
    signal.throwIfAborted();
    if (!canvasId && !["getCanvas", "addCanvas", "switchCanvas"].includes(request.name)) throw new Error("请先选择画布");
    if (isCanvasRead(request.name)) {
      await nextTick();
      signal.throwIfAborted();
      return readCanvas(request, canvasId, signal);
    }
    switch (request.name) {
      case "transcribeAudio": {
        const { path, lang } = asrRequestSchema.parse(request.args);
        if (!isBrowserAudioAsrSupported()) throw new Error("当前浏览器或 WebView 不支持音频文件语音识别");
        const directory = workspaceStore.project?.directory;
        if (!directory) throw new Error("请先选择工作目录");
        const content = await useWorkspaceFiles(directory).read(path);
        signal.throwIfAborted();
        if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("音频不能为空且不能超过 100 MB");
        const url = URL.createObjectURL(new Blob([content]));
        try {
          return await transcribeBrowserAudio(url, { lang, signal });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      case "addCanvas": {
        const { name } = canvasSchemas.addCanvas.parse(request.args);
        return options.menu().addCanvas(name, signal);
      }
      case "switchCanvas": {
        const { canvasId: targetId } = canvasSchemas.switchCanvas.parse(request.args);
        await options.menu().switchCanvas(targetId, signal);
        return targetId;
      }
      case "renameCanvas": {
        const { canvasId: targetId = canvasId, name } = canvasSchemas.renameCanvas.parse(request.args);
        const nextName = name.trim();
        const renamedId = options.menu().peekCanvases().find(canvas => canvas.id === targetId)?.name === nextName
          ? targetId : `${targetId.slice(0, targetId.lastIndexOf("/") + 1)}${nextName}.json`;
        await options.menu().renameCanvas(targetId, nextName, signal);
        return targetId === canvasId ? renamedId : canvasId;
      }
      case "addNode": {
        const args = canvasSchemas.addNode.parse(request.args);
        const type = options.availableNodes.value.find(node => node.type === args.type);
        if (!type) throw new Error("节点类型未启用或尚未加载，请先查询 getCanvas");
        const id = crypto.randomUUID();
        flow.addNodes({ id, type: type.type, position: nodePosition(args.position), data: { label: args.label ?? type.label } });
        await nextTick();
        signal.throwIfAborted();
        flow.updateNodeInternals([id]);
        await nextTick();
        signal.throwIfAborted();
        scheduleReveal(id);
        return nodeInfo(id);
      }
      case "deleteNodes": {
        const { nodeIds } = canvasSchemas.deleteNodes.parse(request.args);
        const idSet = new Set(nodeIds);
        const nodes = nodeIds.map(findNode);
        nodes.forEach(node => {
          if (node.deletable === false) throw new Error(`节点不允许删除：${node.id}`);
          if (flow.getNodes.value.some(item => item.parentNode === node.id && !idSet.has(item.id))) {
            throw new Error(`请先删除此节点的子节点：${node.id}`);
          }
          if (flow.getConnectedEdges(node.id).some(edge => edge.deletable === false)) throw new Error(`节点存在不可删除的连接：${node.id}`);
        });
        for (const node of nodes) {
          await useNodeEvent(node.id, flow).emit("delete");
          signal.throwIfAborted();
          if (flow.findNode(node.id) !== node) throw new Error("节点已被替换，请重新查询画布");
        }
        const edgeIds = flow.getEdges.value.filter(edge => idSet.has(edge.source) || idSet.has(edge.target)).map(edge => edge.id);
        flow.removeNodes(nodeIds, true);
        await nextTick();
        return { nodeIds, removedEdgeIds: edgeIds.slice(0, 100), removedEdgeCount: edgeIds.length, truncated: edgeIds.length > 100 };
      }
      case "moveNodes": {
        const { moves } = canvasSchemas.moveNodes.parse(request.args);
        moves.forEach(move => { if (findNode(move.nodeId).draggable === false) throw new Error(`节点不允许移动：${move.nodeId}`); });
        moves.forEach(move => flow.updateNode(move.nodeId, { position: nodePosition(move.position) }));
        await nextTick();
        return { nodes: moves.map(move => nodeInfo(move.nodeId)) };
      }
      case "renameNodes": {
        const { renames } = canvasSchemas.renameNodes.parse(request.args);
        renames.forEach(rename => findNode(rename.nodeId));
        renames.forEach(rename => flow.updateNodeData(rename.nodeId, { label: rename.label }));
        await nextTick();
        return { nodes: renames.map(rename => nodeInfo(rename.nodeId)) };
      }
      case "connectNodes": {
        const { connections } = canvasSchemas.connectNodes.parse(request.args);
        const edges = [...flow.getEdges.value];
        const entries = connections.map(connection => {
          const sourceNode = findNode(connection.source);
          const targetNode = findNode(connection.target);
          if (!flow.nodesConnectable.value || sourceNode.connectable === false || targetNode.connectable === false) {
            throw new Error(`节点不允许连接：${connection.source} -> ${connection.target}`);
          }
          const existing = edges.find(edge => edge.source === connection.source && edge.target === connection.target
            && edge.sourceHandle === connection.sourceHandle && edge.targetHandle === connection.targetHandle);
          if (existing) return { id: existing.id, connection, isNew: false };
          if (!validateConnection(connection, { sourceNode, targetNode, nodes: flow.getNodes.value, edges })) {
            throw new Error(`连接无效：${connection.source} -> ${connection.target}，请检查端口方向、数据类型以及目标节点的连接规则`);
          }
          const id = crypto.randomUUID();
          // ACT: 候选边只参与本批校验，全部通过后再一次提交画布。
          edges.push({
            ...connection, id, type: "default", selected: false, data: {}, events: {}, sourceNode, targetNode,
            sourceX: sourceNode.computedPosition.x, sourceY: sourceNode.computedPosition.y,
            targetX: targetNode.computedPosition.x, targetY: targetNode.computedPosition.y,
          });
          return { id, connection, isNew: true };
        });
        flow.addEdges(entries.filter(entry => entry.isNew).map(entry => ({ id: entry.id, ...entry.connection })));
        await nextTick();
        // ACT: 端点虽然已按断言校验，回执仍统一剔除禁用端点，防止后续放宽断言时泄露。
        return { edges: entries.map(entry => canvasEdgeSummary(flow.findEdge(entry.id)!)).filter(edge => !isNodeDisabled(edge.source) && !isNodeDisabled(edge.target)) };
      }
      case "deleteEdges": {
        const { edgeIds } = canvasSchemas.deleteEdges.parse(request.args);
        const edges = edgeIds.map(edgeId => {
          const edge = flow.findEdge(edgeId);
          if (!edge) throw new Error(`连线不存在：${edgeId}`);
          if (edge.deletable === false) throw new Error(`连线不允许删除：${edgeId}`);
          return edge;
        });
        // ACT: 端点摘要必须在 removeEdges 之前用非断言查找收集——走统一断言会形成
        // 「边已删、回执却抛错」的半完成状态；禁用节点的摘要不回显。
        const nodeIds = [...new Set(edges.flatMap(edge => [edge.source, edge.target]))];
        const nodes = nodeIds.flatMap(id => (flow.findNode(id) && !isNodeDisabled(id) ? [nodeInfo(id)] : []));
        flow.removeEdges(edgeIds);
        await nextTick();
        return { edgeIds, nodes };
      }
      case "selectNodes": {
        const { nodeIds } = canvasSchemas.selectNodes.parse(request.args);
        const nodes = nodeIds.map(findNode);
        if (nodes.some(node => node.selectable === false)) throw new Error("节点不允许选择");
        flow.removeSelectedElements();
        flow.addSelectedNodes(nodes);
        await nextTick();
        const selected = flow.getSelectedNodes.value;
        return { selectedNodeIds: selected.slice(0, 100).map(node => node.id), selectedCount: selected.length, truncated: selected.length > 100 };
      }
      case "arrangeCanvas": {
        canvasSchemas.arrangeCanvas.parse(request.args);
        const { arrangedNodeIds, viewport } = await arrangeCanvas(flow, signal);
        // ACT: 整理是选择级操作，禁用节点照常参与排版，但回执不列出它们的 ID。
        const visible = arrangedNodeIds.filter(id => !isNodeDisabled(id));
        return { arrangedNodeIds: visible.slice(0, 100), arrangedCount: visible.length, truncated: visible.length > 100, viewport };
      }
      case "fitCanvas": {
        const { nodeIds } = canvasSchemas.fitCanvas.parse(request.args);
        // ACT: 显式 nodeIds 走统一断言（禁用即抛错）；省略时静默过滤，计数也只算可见节点。
        nodeIds?.forEach(findNode);
        await nextTick();
        signal.throwIfAborted();
        const targetIds = nodeIds ?? flow.getNodes.value.filter(node => node.data?.disabled !== true).map(node => node.id);
        // ACT: 省略 nodeIds 且画布上全是禁用节点时不要回落成「适配全部」——那会把已屏蔽的节点重新框进视口。
        if (nodeIds === undefined && !targetIds.length) {
          return { fitted: false, nodeIds: [], nodeCount: 0, truncated: false, viewport: { ...flow.viewport.value } };
        }
        flow.updateNodeInternals(targetIds);
        const fitted = await flow.fitView({ nodes: targetIds, padding: 0.2, duration: 0 });
        signal.throwIfAborted();
        return { fitted, nodeIds: nodeIds?.slice(0, 100), nodeCount: targetIds.length, truncated: (nodeIds?.length ?? 0) > 100, viewport: { ...flow.viewport.value } };
      }
      case "nodeTools": {
        const args = canvasSchemas.nodeTools.parse(request.args);
        // ACT: 调用目标节点必须是启用状态；显式按 ID 命中禁用节点直接抛错。
        findNode(args.nodeId);
        return getNodeTools().call(args, signal);
      }
      default: throw new Error(`未知画布操作：${request.name}`);
    }
  }
}
