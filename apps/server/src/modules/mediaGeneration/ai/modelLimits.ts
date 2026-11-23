import modelContextLimits from "@/modules/mediaGeneration/ai/modelContextLimits";

/**
 * ACT: 窗口与输出上限按字段独立解析。
 * 用户显式填写的值代表他对这条线路（尤其是一人一中转）的实际声明，必须优先；
 * 硬编码表与 Pi 内置目录只是「用户没填」时的默认值，不能反向覆盖用户配置。
 * 旧实现命中硬编码表就整条返回，导致 512k 的中转被按 1M 计算，自动压缩迟迟不触发。
 */
export type LimitModelConfig = {
  id: string;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
};

/** 只取解析需要的字段，避免把 SDK 的完整 Model 类型带进纯逻辑。 */
export type BuiltinLimitModel = {
  id: string;
  provider?: string;
  contextWindow?: number;
  maxTokens?: number;
};

const positive = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

/** ACT: 跨供应商同名模型只在参数逐项一致时采用，不猜别名。 */
function sharedValue<T>(candidates: BuiltinLimitModel[], read: (item: BuiltinLimitModel) => T | undefined) {
  if (!candidates.length) return undefined;
  const first = read(candidates[0]!);
  if (first === undefined) return undefined;
  return candidates.every(item => read(item) === first) ? first : undefined;
}

export function resolveModelLimits(providerId: string, model: LimitModelConfig, builtinModels: BuiltinLimitModel[]) {
  const table = modelContextLimits.find(item => item.id === model.id)
    ?? modelContextLimits.find(item => item.id instanceof RegExp && model.id.search(item.id) !== -1);
  const matches = builtinModels.filter(item => item.id === model.id);
  // ACT: 与 getModelReasoning 同口径，供应商 id 不区分大小写，避免同一目录因大小写落到不同分支。
  const exact = matches.find(item => item.provider?.toLowerCase() === providerId.toLowerCase());
  const candidates = exact ? [exact] : matches;
  return {
    contextWindow: positive(model.contextWindow)
      ?? table?.contextWindow
      ?? positive(sharedValue(candidates, item => item.contextWindow))
      ?? 262144,
    maxTokens: positive(model.maxOutputTokens)
      ?? table?.maxTokens
      ?? positive(sharedValue(candidates, item => item.maxTokens))
      ?? 32768,
  };
}
