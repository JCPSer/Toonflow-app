import { computed, ref } from "vue";
import { defineStore } from "pinia";

export type TaskAlertKind = "done" | "failed";
export type TaskAlert = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  kind: TaskAlertKind;
  durationMs: number;
  at: number;
  read: boolean;
  /** 事件发生时节点所在画布；点击时先用它在同实例内定位，定位不到再切画布。 */
  canvasId?: string;
  /** 画布实例键：重命名/移动画布后 canvasId 会变，key 不变，优先用它匹配实例。 */
  canvasKey?: string;
};

/** 跨画布定位请求：目标实例在 `active && canvasReady` 时消费一次。 */
export type TaskAlertFocus = { nodeId: string; canvasId?: string; canvasKey?: string };

/** 未读队列上限：只是画布顶部的临时提醒，保留最近 50 条足够翻到刚切回来的项目。 */
const MAX_ALERTS = 50;

/** 耗时文案：30s 起才会出现，再长按分/小时收敛，避免横幅里出现一串毫秒。 */
export function formatTaskDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const seconds = totalSeconds % 60;
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m${seconds ? `${seconds}s` : ""}`;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  return `${Math.floor(totalSeconds / 3600)}h${minutes ? `${minutes}m` : ""}`;
}

export const useTaskAlertsStore = defineStore("taskAlerts", () => {
  // ACT: 只放内存：这是「刚才发生了什么」的提示，不是历史记录；切项目后跨项目提醒会指错画布。
  const alerts = ref<TaskAlert[]>([]);
  const unread = computed(() => alerts.value.filter(alert => !alert.read));
  // ACT: 跨画布点击没法直接拿到目标画布的 Vue Flow 实例，只能把「要定位哪个节点」挂在这里，
  // 由被激活的实例自己在 active && canvasReady 时消费一次。
  const pendingFocus = ref<TaskAlertFocus | null>(null);

  function requestFocus(focus: TaskAlertFocus) {
    pendingFocus.value = focus;
  }

  function clearPendingFocus() {
    pendingFocus.value = null;
  }

  function push(alert: Omit<TaskAlert, "id" | "read">) {
    alerts.value = [{ ...alert, id: crypto.randomUUID(), read: false }, ...alerts.value].slice(0, MAX_ALERTS);
  }

  function markRead(id: string) {
    const alert = alerts.value.find(item => item.id === id);
    if (alert) alert.read = true;
  }

  /** 点开某个节点时，同一节点的多条提醒一起算已读。 */
  function markReadByNode(nodeId: string) {
    for (const alert of alerts.value) if (alert.nodeId === nodeId) alert.read = true;
  }

  function clear() {
    alerts.value = [];
  }

  return { alerts, unread, pendingFocus, push, markRead, markReadByNode, clear, requestFocus, clearPendingFocus };
});
