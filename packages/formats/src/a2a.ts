// ACT: A2A 设置形状是配置层与 agent 层共用的纯契约，下沉到 foundation 以切断 conf → agent 的类型边。
import type { ThinkingLevel } from "./modelReasoning";

export type A2aSettings = {
  enabled: boolean;
  directory: string;
  token: string;
  providerId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
};
