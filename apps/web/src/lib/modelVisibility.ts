import type { CustomProvider, CustomProviderModel, HiddenKind, ModelsHidden } from "@/stores/settings";

export function modelKey(providerId: string, modelId: string) {
  return JSON.stringify([providerId, modelId]);
}

// ACT: 只统计仍存在的模型；删除模型后残留的隐藏记录不计入展示数量。
export function hiddenModelCount(kind: HiddenKind, hidden: ModelsHidden, providerId: string, modelIds: readonly string[]) {
  const hiddenIds = hidden.models[kind][providerId] ?? [];
  return hiddenIds.length ? modelIds.filter(id => hiddenIds.includes(id)).length : 0;
}

// ACT: 与节点下拉同一套规则——隐藏项不展示，但当前选中项保留并标注，且空分组整组去掉。
export function visibleLanguageProviders(providers: readonly CustomProvider[], hidden: ModelsHidden, selected?: string): CustomProvider[] {
  const hiddenProviders = hidden.providers.language;
  const hiddenModels = hidden.models.language;
  return providers.flatMap(provider => {
    const providerHidden = hiddenProviders.includes(provider.id);
    const modelIds = hiddenModels[provider.id] ?? [];
    const models = provider.models.flatMap((model: CustomProviderModel) => {
      const hiddenModel = providerHidden || modelIds.includes(model.id);
      if (hiddenModel && modelKey(provider.id, model.id) !== selected) return [];
      return [hiddenModel ? { ...model, label: `${model.label}（已隐藏）` } : model];
    });
    return models.length ? [{ ...provider, models }] : [];
  });
}
