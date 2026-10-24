import type { NodeAiModel } from "@toonflow/nodes-scaffold/nodeAi";

export function nodeModelValue(providerId: string, modelId: string) {
  return JSON.stringify([providerId, modelId]);
}

export function groupNodeModels<T extends Pick<NodeAiModel, "providerId" | "providerLabel"> & { modelId: string; label: string; hidden?: boolean }>(
  models: readonly T[],
  selected?: string,
) {
  // ACT: 设置里隐藏的模型不出现在下拉中，但当前选中项必须保留并标注，避免旧项目静默选不中。
  const visible = models.filter(item => !item.hidden || nodeModelValue(item.providerId, item.modelId) === selected)
    .map(item => (item.hidden ? { ...item, label: `${item.label}（已隐藏）` } : item));
  return [...Map.groupBy(visible, item => item.providerId)].map(([id, items]) => ({
    id, label: items[0]!.providerLabel, models: items,
  })).sort((left, right) => Number(right.id === "tfRouter") - Number(left.id === "tfRouter"));
}
