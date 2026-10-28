<template>
  <nodeSkeleton v-bind="nodeProps" :running="status === 'thinking' || status === 'running'" :busy="status === 'thinking' || status === 'running'" style="width: 300px">
    <div class="agentContent">
      <div class="statusRow" :class="`is-${status}`">
        <span class="statusDot" aria-hidden="true" />
        <span>{{ STATUS_LABELS[status] }}</span>
      </div>
      <p v-if="lastPrompt" class="lastPrompt" :title="lastPrompt">{{ lastPrompt }}</p>
      <div v-else class="emptyPrompt">
        <icon-robot :size="18" stroke="1.6" aria-hidden="true" />
        <span>添加技能给我任务</span>
      </div>
      <div class="inputSummary" :title="inputSummary">
        <icon-grip-horizontal class="summaryIcon" :size="14" aria-hidden="true" />
        <span class="summaryText">{{ inputSummary }}</span>
      </div>
    </div>
  </nodeSkeleton>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { IconGripHorizontal, IconRobot } from "@tabler/icons-vue";
import {
  nodeSkeleton,
  useAgentNodeStatus,
  useNode,
  type AgentNodeStatus,
  type NodeHandle,
} from "@toonflow/nodes-scaffold/runtime";

defineOptions({
  inheritAttrs: false,
  icon: IconRobot,
  handles: [{ id: "in", type: "target", dataType: "*", label: "文本、图片、视频、音频、文件输入" }] satisfies NodeHandle[],
});

const { id, node, nodeProps, nodeEvent } = useNode({ label: "Agent", outputs: {} });
const status = useAgentNodeStatus(id);
const lastPrompt = computed(() => (node.data as { agentLastPrompt?: string }).agentLastPrompt);

const STATUS_LABELS: Record<AgentNodeStatus, string> = {
  idle: "待开始",
  waiting: "等待输入",
  thinking: "理解中",
  running: "运行中",
};

const TYPE_LABELS: Record<string, string> = {
  STRING: "文本",
  IMAGE: "图片",
  VIDEO: "视频",
  AUDIO: "音频",
  FILE: "文件",
  MASK: "遮罩",
  INT: "整数",
  FLOAT: "小数",
  BOOLEAN: "布尔",
};

const inputSummary = ref("无输入");

function primaryType(dataType: string | string[]) {
  const types = (Array.isArray(dataType) ? dataType : dataType.split(","))
    .map(type => type.trim())
    .filter(type => type && type !== "*");
  return types[0] ?? "*";
}

// ACT: 摘要只做端口计数；文本额外累计字数，上游尚未输出时仍计入连接数量。
nodeEvent.on("input:in", values => {
  const groups = new Map<string, { count: number; chars: number }>();
  for (const input of values) {
    const type = primaryType(input.dataType);
    const group = groups.get(type) ?? { count: 0, chars: 0 };
    group.count += 1;
    if (typeof input.value === "string") group.chars += input.value.length;
    groups.set(type, group);
  }
  inputSummary.value = groups.size
    ? [...groups].map(([type, group]) => {
        const label = TYPE_LABELS[type] ?? (type === "*" ? "输入" : type);
        return type === "STRING" ? `${label} ${group.chars} 字` : `${label} ${group.count}`;
      }).join(" · ")
    : "无输入";
});

// ACT: 复制/粘贴/拖拽复制时不能把会话文件一起带走——两个节点指向同一个 jsonl 会互相覆盖上下文，
// 第二个发消息还会撞上会话锁。这里只留一个「待克隆」指针，新节点首次打开面板时才真正分叉。
nodeEvent.on("copy", () => {
  const data = node.data as { agentSessionFile?: string; agentSessionCloneFrom?: string };
  if (!data.agentSessionFile) return {};
  return { agentSessionFile: undefined, agentSessionCloneFrom: data.agentSessionFile, agentLastPrompt: undefined };
});
</script>

<style lang="scss" scoped>
.agentContent {
  display: flex;
  min-height: 104px;
  flex-direction: column;
  gap: 10px;
  padding: 2px 4px;
  color: var(--el-text-color-regular);
  font-size: 12px;
}

.statusRow {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  line-height: 18px;

  &.is-thinking,
  &.is-running {
    color: var(--el-color-primary);
  }

  &.is-running .statusDot {
    opacity: 1;
  }

  &.is-thinking .statusDot {
    animation: agentDot 1.2s ease-in-out infinite;
  }
}

.statusDot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}

.lastPrompt {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  line-height: 18px;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.emptyPrompt {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px dashed var(--el-border-color);
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-placeholder);
  line-height: 18px;
}

.inputSummary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  line-height: 16px;
}

.summaryIcon {
  flex: none;
  color: var(--el-text-color-placeholder);
}

.summaryText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes agentDot {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .statusRow.is-thinking .statusDot {
    animation: none;
  }
}
</style>
