import type { CanvasToolCall, QuestionRequest, ToolCall } from "@toonflow/tools-scaffold/runtime";
import type { ThinkingLevel } from "../../lib/modelReasoning";

export type AgentToolCall = ToolCall & { question?: QuestionRequest & { callId: string } };

export type AgentMention = {
  id: string;
  label: string;
  // ACT: 没有 outputId 表示「节点引用」，只带画布与节点身份；有 outputId 才是输出引用，value 为输出内容。
  source:
    | { kind: "canvas"; canvasId: string; canvasName: string; nodeId: string; nodeName: string; outputId?: string; outputName?: string }
    | { kind: "asset"; path: string; library?: "global" | "project" };
  dataType: string;
  value: unknown;
};

export type AgentStats = {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  tokensPerSecond?: number;
};

export type AgentContext = { tokens: number | null; contextWindow: number; percent: number | null };

export type AgentSubAgent = {
  file: string;
  parentFile: string;
  name: string;
  task: string;
  status: "running" | "completed" | "error" | "limited" | "cancelled" | "inputRequired";
  result?: string;
  providerId?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel;
};

export type AgentEvent =
  | { type: "text" | "thinking"; blockId: string; delta?: string; content?: string; done?: boolean }
  | { type: "compaction"; active: boolean }
  | { type: "tool"; blockId: string; tool: AgentToolCall }
  | ({ type: "canvasCall"; callId: string } & CanvasToolCall)
  | ({ type: "question"; callId: string; toolCallId: string } & QuestionRequest)
  | { type: "error"; message: string }
  | { type: "retry"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
  | { type: "session"; file: string }
  | { type: "userMessage"; id: string; content?: string; attachments?: { name: string; path: string; mimeType: string }[]; mentions?: AgentMention[] }
  | { type: "subAgent"; agent: AgentSubAgent }
  | { type: "subAgentEvent"; file: string; event: AgentEvent }
  | { type: "report"; parentFile: string; file: string; name: string; content: string; id: string }
  | { type: "accepted" }
  | { type: "stats"; stats: AgentStats; contextUsage?: AgentContext }
  | { type: "done" };
