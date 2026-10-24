import conf from "@/utils/conf";

export type ModelKind = "language" | "media";

// ACT: 隐藏状态存在 settings.modelsHidden 旁路，不写入供应商或模型对象——媒体供应商配置会被原样传给插件运行时。
export type ModelsHidden = {
  providers?: Partial<Record<ModelKind, string[]>>;
  models?: Partial<Record<ModelKind, Record<string, string[]>>>;
};

export type ModelVisibility = {
  providers: Set<string>;
  models: Map<string, Set<string>>;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecord(value: unknown): Record<string, string[]> {
  const source = record(value);
  return Object.fromEntries(Object.entries(source).map(([key, list]) => [key, stringList(list)]).filter(([, list]) => list.length));
}

export function readModelsHidden(): ModelsHidden {
  const raw = record(conf.get("settings", {})).modelsHidden;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const providers = record(value.providers);
  const models = record(value.models);
  return {
    providers: { language: stringList(providers.language), media: stringList(providers.media) },
    models: { language: stringRecord(models.language), media: stringRecord(models.media) },
  };
}

// ACT: 列表接口一次读出全部可见性，避免逐个模型重复解析设置。
export function readModelVisibility(kind: ModelKind): ModelVisibility {
  const hidden = readModelsHidden();
  const models = new Map<string, Set<string>>();
  for (const [providerId, ids] of Object.entries(hidden.models?.[kind] ?? {})) {
    const list = stringList(ids);
    if (list.length) models.set(providerId, new Set(list));
  }
  return { providers: new Set(hidden.providers?.[kind] ?? []), models };
}

// ACT: 供应商被删除后清掉隐藏记录，避免同名供应商重新安装时继承旧状态。
export function forgetHidden(kind: ModelKind, providerId: string) {
  const raw = record(conf.get("settings", {})).modelsHidden;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  const providers = record(value.providers);
  const models = record(value.models);
  const nextProviders = { ...providers, [kind]: stringList(providers[kind]).filter(id => id !== providerId) };
  const kindModels = { ...stringRecordForget(models[kind], providerId) };
  conf.set("settings.modelsHidden", { ...value, providers: nextProviders, models: { ...models, [kind]: kindModels } });
}

function stringRecordForget(value: unknown, key: string): Record<string, string[]> {
  const source = record(value);
  const next = { ...source };
  delete next[key];
  return next as Record<string, string[]>;
}

export function isHidden(visibility: ModelVisibility, providerId: string, modelId?: string) {
  // ACT: 供应商隐藏优先，其下模型即使启用也不出现在列表里。
  if (visibility.providers.has(providerId)) return true;
  return modelId === undefined ? false : visibility.models.get(providerId)?.has(modelId) === true;
}
