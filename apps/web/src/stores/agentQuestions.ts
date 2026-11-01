import { ref, watch } from "vue";
import { defineStore } from "pinia";
import type { AgentQuestionNotice } from "@/components/agent/types";
import { useWorkspaceStore } from "@/stores/workspace";

/** 横幅里的一条提问；canvasKey 是画布实例键，canvasId 在画布改名后会变，点击时以 key 定位实例。 */
export type CanvasAgentQuestion = AgentQuestionNotice & { canvasId?: string; canvasKey: string };

/** 跨画布跳转请求：目标实例在 active && canvasReady 时消费一次。 */
export type AgentQuestionFocus = { nodeId: string; canvasKey: string };

/**
 * ACT: 画布实例之间互相拿不到对方的 Vue Flow，提问又来自各画布自己的 Agent 面板；
 * 把未回答提问放在全局 store 里，任何画布顶部横幅都能看到并跳到提问节点所在画布。
 * 只放内存：切项目后工作区销毁，旧画布的提问请求本身也已中断。
 */
export const useAgentQuestionsStore = defineStore("agentQuestions", () => {
  const notices = ref<CanvasAgentQuestion[]>([]);
  const pendingFocus = ref<AgentQuestionFocus | null>(null);

  /** 面板每次上报的是本画布全量未回答提问，按 canvasKey 整组替换，避免增量对不上。 */
  function sync(canvasKey: string, canvasId: string, list: AgentQuestionNotice[]) {
    notices.value = [
      ...list.map(item => ({ ...item, canvasId, canvasKey })),
      ...notices.value.filter(item => item.canvasKey !== canvasKey),
    ];
  }

  /** 画布改名/换文件后，旧条目里的 canvasId 会指错；只更新路径，不重建条目。 */
  function setCanvasId(canvasKey: string, canvasId: string) {
    for (const item of notices.value) {
      if (item.canvasKey === canvasKey) item.canvasId = canvasId;
    }
  }

  function removeCanvas(canvasKey: string) {
    notices.value = notices.value.filter(item => item.canvasKey !== canvasKey);
    if (pendingFocus.value?.canvasKey === canvasKey) pendingFocus.value = null;
  }

  /** 节点被删除/禁用或跳转失败时只删这一条，其他提问继续保留。 */
  function removeQuestion(canvasKey: string, nodeId: string) {
    notices.value = notices.value.filter(item => item.canvasKey !== canvasKey || item.nodeId !== nodeId);
  }

  function requestFocus(nodeId: string, canvasKey: string) {
    pendingFocus.value = { nodeId, canvasKey };
  }

  function clearPendingFocus() {
    pendingFocus.value = null;
  }

  // ACT: 切项目会销毁工作区，但画布实例的卸载顺序不可依赖；与任务提醒一样按目录显式清空，
  // 避免旧项目的提问路径短暂显示在新项目画布上。
  const workspace = useWorkspaceStore();
  watch(() => workspace.project?.directory, () => {
    notices.value = [];
    pendingFocus.value = null;
  });

  return { notices, pendingFocus, sync, setCanvasId, removeCanvas, removeQuestion, requestFocus, clearPendingFocus };
});
