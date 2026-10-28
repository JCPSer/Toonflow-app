import { nextTick } from "vue";

/** 只依赖 Vue Flow 里真正用到的那几个成员，避免把 useVueFlow 的返回类型泄漏到节点包里。 */
type ViewportFlow = {
  viewport: { value: { x: number; y: number; zoom: number } };
  dimensions: { value: { width: number; height: number } };
  findNode(id: string): { computedPosition: { x: number; y: number }; dimensions: { width: number; height: number } } | undefined;
  updateNodeInternals(ids: string[]): void;
  setCenter(x: number, y: number, options: { zoom: number; duration: number }): Promise<boolean> | unknown;
};

/**
 * ACT: 自动新增的节点经常落在视口外，用户得自己拖画布去找。这里只做「看不见就移过去」，
 * 不改节点坐标——调用方（AI 或节点逻辑）推算的上下游相对布局必须原样保留。
 *
 * 尺寸刚加进来时是 0×0（Vue Flow 的 ResizeObserver 回调还要再等一个 nextTick），
 * 所以先强制同步内部尺寸；仍然量不到时按常见节点尺寸估算中心，避免把镜头对到左上角。
 */
export async function revealNodeInViewport(flow: ViewportFlow, nodeId: string, options: { margin?: number; duration?: number } = {}) {
  flow.updateNodeInternals([nodeId]);
  await nextTick();
  const node = flow.findNode(nodeId);
  const { width, height } = flow.dimensions.value;
  const { x, y, zoom } = flow.viewport.value;
  if (!node || !width || !height || !zoom) return false;
  // ACT: 内边距按屏幕像素给，要除以缩放换算回画布坐标，否则放大时留白被放大、缩小时几乎贴边。
  const margin = (options.margin ?? 40) / zoom;
  const nodeWidth = node.dimensions.width || 240;
  const nodeHeight = node.dimensions.height || 180;
  const visible = node.computedPosition.x >= -x / zoom + margin
    && node.computedPosition.y >= -y / zoom + margin
    && node.computedPosition.x + nodeWidth <= (width - x) / zoom - margin
    && node.computedPosition.y + nodeHeight <= (height - y) / zoom - margin;
  if (visible) return false;
  // ACT: 保持当前缩放只平移，手感更连贯；显式传 zoom 是必须的——setCenter 不传时默认会跳到 maxZoom。
  await flow.setCenter(node.computedPosition.x + nodeWidth / 2, node.computedPosition.y + nodeHeight / 2, { zoom, duration: options.duration ?? 240 });
  return true;
}
