import { z } from "zod";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@/agent/runtime/types";
import { resolveDispatchLimit } from "@/agent/runtime/dispatchLimits";
import type { ThinkingLevel } from "@toonflow/formats/modelReasoning";

/** 同画布 Agent 派发上下文；只在对顶层、已绑定画布节点的会话里注入。 */
export type AgentDispatchContext = {
  sessionFile: string;
  nodeId: string;
  canvasId: string;
  providerId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  depth: number;
  /** 开发者设置的任务链上限；缺省按默认 8，旧调用点无需改动。 */
  maxDepth?: number;
  send: (event: AgentEvent) => void;
};

const dispatchSchema = z.strictObject({
  nodeId: z.string().min(1).max(256),
  message: z.string().trim().min(1).max(8000),
});


/**
 * ACT: 只向画布 dispatcher 下发派发意图，不在这里执行目标 Agent。
 * 目标是否存在/是否 Agent/是否禁用、排队、并发、去重都由同画布的 dispatcher 校验——
 * 它才持有实时画布数据与执行流。
 */
export function createSendToAgentTool(context: AgentDispatchContext): ToolDefinition {
  return {
    name: "sendToAgent",
    label: "给画布上的其他 Agent 派活",
    description: "把任务派给同一画布上的另一个 Agent 节点。调用后立即返回任务 id，对方完成后结果会作为一条新消息回到本会话；不要等待或轮询。如果对方正在执行你之前派的任务，这条会打断上一轮并立刻执行；如果对方正在执行其他 Agent 的任务，会排队，且你之前排队但未开始的任务会被这条替换（其他 Agent 的排队不受影响）。只能派给同一画布的 Agent 节点，不能派给自己。",
    promptSnippet: "用 sendToAgent 把可独立完成的任务派给同画布的其他 Agent，不要自己替它做完；需要改变它正在做的事就直接再派一条，它会打断自己上一轮。",
    parameters: z.toJSONSchema(dispatchSchema, { io: "input", target: "draft-07" }),
    async execute(_toolCallId, params) {
      const { nodeId, message } = dispatchSchema.parse(params);
      if (nodeId === context.nodeId) throw new Error("不能把任务派给自己");
      const maxDepth = resolveDispatchLimit(context.maxDepth);
      if (context.depth >= maxDepth) throw new Error(`任务链路已达到 ${maxDepth} 跳上限，不能再派发`);
      const taskId = crypto.randomUUID();
      context.send({
        type: "agentDispatch", taskId,
        fromNodeId: context.nodeId, toNodeId: nodeId, fromSession: context.sessionFile,
        message, depth: context.depth, maxDepth,
        model: {
          providerId: context.providerId, modelId: context.modelId,
          ...(context.thinkingLevel ? { thinkingLevel: context.thinkingLevel } : {}),
        },
      });
      return {
        // ACT: 排队/打断由调用方的画布调度器决定，工具只确认"已受理"，不承诺排队位置。
        content: [{ type: "text", text: JSON.stringify({ taskId, accepted: true, status: "dispatched" }) }],
        details: {},
      };
    },
  };
}
