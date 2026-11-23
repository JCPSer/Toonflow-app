/**
 * ACT: 任务链深度上限由开发者设置控制；服务端工具与画布 dispatcher 必须共用同一默认值与范围，
 * 否则会出现「服务端允许、画布拒绝」或反之。结果回传不增加深度，因此这里只约束新的派发。
 */
export const DEFAULT_DISPATCH_MAX_DEPTH = 8;
export const MIN_DISPATCH_MAX_DEPTH = 1;
export const MAX_DISPATCH_MAX_DEPTH = 32;
/**
 * ACT: 开发者选择「不限制」时使用的实际上限。用有限大值而不是 Infinity：
 * 事件要经 JSON 传输（Infinity 会变成 null），且极端递归仍需要兜底。
 */
export const UNLIMITED_DISPATCH_MAX_DEPTH = 1000;

export function normalizeDispatchMaxDepth(value: unknown) {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_DISPATCH_MAX_DEPTH;
  return Math.min(MAX_DISPATCH_MAX_DEPTH, Math.max(MIN_DISPATCH_MAX_DEPTH, number));
}

/** ACT: 运行期生效上限。可接受“不限制”档的 1000，但仍以 1000 作为绝对兜底。 */
export function resolveDispatchLimit(value: unknown) {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_DISPATCH_MAX_DEPTH;
  return Math.min(UNLIMITED_DISPATCH_MAX_DEPTH, Math.max(MIN_DISPATCH_MAX_DEPTH, number));
}
