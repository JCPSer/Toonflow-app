<template>
  <div
    ref="bar"
    class="comfyMonitor"
    :class="{ collapsed, offline: !status.online, dragging: Boolean(dragging) }"
    :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    @pointerdown.stop="startDragFromBar"
    @click.stop
    @dblclick.stop
    @wheel.stop>
    <span class="handle" role="button" tabindex="0" aria-label="拖动状态栏" title="拖动">
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="3" r="1.2" /><circle cx="10" cy="3" r="1.2" /><circle cx="6" cy="8" r="1.2" /><circle cx="10" cy="8" r="1.2" /><circle cx="6" cy="13" r="1.2" /><circle cx="10" cy="13" r="1.2" /></g></svg>
    </span>
    <span class="dot" :title="status.error || (status.online ? '在线' : '离线')" />
    <span class="targetName">{{ activeTarget?.label || '未配置' }}</span>

    <template v-if="!collapsed">
      <span v-for="item in visibleItems" :key="item" class="chip" :class="{ missing: isMissing(item) }" :title="isMissing(item) ? missingHint(item) : undefined">
        <span class="chipLabel">{{ labels[item] }}</span>
        <span class="chipValue">{{ itemText(item) }}</span>
        <span v-if="percentOf(item) !== undefined" class="bar"><i :style="{ width: `${percentOf(item)}%` }" :class="levelClass(item)" /></span>
      </span>
      <span v-if="!activeTarget" class="chip hint">点击右侧设置添加监控地址</span>
      <span v-else-if="!status.online" class="chip error" :title="status.error">离线</span>
    </template>

    <button class="iconButton" :aria-label="collapsed ? '展开' : '折叠'" :title="collapsed ? '展开' : '折叠'" @click="toggleCollapsed">
      <component :is="collapsed ? IconChevronRight : IconChevronDown" :size="13" />
    </button>
    <button class="iconButton" :disabled="freeing || !activeTarget" :aria-label="`清理显存 ${activeTarget?.label ?? ''}`" :title="freeing ? '正在清理显存' : '清理显存（卸载已加载的模型）'" @click="freeVram">
      <span v-if="freeing" class="spin"><IconEraser :size="13" /></span>
      <IconEraser v-else :size="13" />
    </button>
    <el-popover v-model:visible="settingsVisible" placement="bottom-end" :width="340" trigger="click" popperClass="comfyMonitorSettings">
      <template #reference>
        <button class="iconButton" aria-label="状态栏设置" title="设置"><IconSettings :size="13" /></button>
      </template>
      <div class="settings">
        <div class="sectionTitle">监控目标</div>
        <div v-for="target in config.targets" :key="target.id" class="targetRow">
          <el-radio v-model="config.active" :value="target.id" :aria-label="`切换到 ${target.label || target.url}`" />
          <el-input v-model="target.label" size="small" placeholder="名称" aria-label="目标名称" @change="persist" />
          <el-input v-model="target.url" size="small" placeholder="http://192.168.2.6:8188" aria-label="目标地址" @change="targetChanged" />
          <el-button text size="small" :icon="IconTrash" aria-label="删除目标" @click="removeTarget(target.id)" />
        </div>
        <el-button class="addTarget" text size="small" :icon="IconPlus" @click="addTarget">添加目标</el-button>

        <div class="sectionTitle">刷新间隔</div>
        <el-radio-group v-model="config.interval" size="small" @change="persist">
          <el-radio-button :value="2000">2 秒</el-radio-button>
          <el-radio-button :value="3000">3 秒</el-radio-button>
          <el-radio-button :value="5000">5 秒</el-radio-button>
          <el-radio-button :value="10000">10 秒</el-radio-button>
        </el-radio-group>

        <div class="sectionTitle">显示项</div>
        <div class="itemGrid">
          <el-checkbox v-for="key in itemKeys" :key="key" v-model="config.items[key]" :label="labels[key]" @change="persist" />
        </div>

        <div class="sectionTitle">采集脚本</div>
        <p class="hintText">CPU 使用率、GPU 利用率、温度、功耗需要把采集脚本放进 ComfyUI 的 custom_nodes 目录后重启 ComfyUI。</p>
        <div class="scriptActions">
          <el-button size="small" :icon="IconCopy" @click="copyScript">复制采集脚本</el-button>
          <el-text size="small" type="info">{{ copied ? "已复制" : "toonflow_metrics.py" }}</el-text>
        </div>
        <p class="hintText">依赖（可选）：pip install psutil pynvml</p>
      </div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElButton, ElCheckbox, ElInput, ElPopover, ElRadio, ElRadioButton, ElRadioGroup, ElText } from "element-plus";
import { ElMessage } from "element-plus";
import { IconChevronDown, IconChevronRight, IconCopy, IconEraser, IconPlus, IconSettings, IconTrash } from "@tabler/icons-vue";
import type { ExtContext } from "@toonflow/ext-scaffold/runtime";
import script from "../sidecar/toonflow_metrics.py?raw";

const props = defineProps<{ context: ExtContext }>();

const itemKeys = ["cpu", "ram", "vram", "gpu", "temperature", "power", "queue", "version"] as const;
type ItemKey = (typeof itemKeys)[number];
type Target = { id: string; label: string; url: string };
type Gpu = { index: number; name?: string; type?: string; vramTotal?: number; vramUsed?: number; vramPercent?: number; util?: number; temperature?: number; power?: number };
type Status = {
  online: boolean;
  source?: string;
  system?: { os?: string; version?: string; cpuPercent?: number; cores?: number; ramTotal?: number; ramUsed?: number; ramPercent?: number };
  gpus?: Gpu[];
  queue?: { running?: number; pending?: number };
  missing?: string[];
  error?: string;
};

const labels: Record<ItemKey, string> = {
  // ACT: 温度和功耗只来自显卡，标题写清楚，避免和 CPU 混淆。
  cpu: "CPU", ram: "内存", vram: "显存", gpu: "GPU 利用率", temperature: "GPU 温度", power: "GPU 功耗", queue: "队列", version: "版本",
};

function readConfig(raw: Record<string, unknown>) {
  const targets = Array.isArray(raw.targets)
    ? raw.targets.flatMap((item): Target[] => {
      const target = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
      const url = typeof target.url === "string" ? target.url : "";
      if (!url) return [];
      return [{ id: typeof target.id === "string" && target.id ? target.id : crypto.randomUUID(), label: typeof target.label === "string" ? target.label : url, url }];
    })
    : [];
  const items = { ...Object.fromEntries(itemKeys.map(key => [key, true])) } as Record<ItemKey, boolean>;
  const savedItems = raw.items && typeof raw.items === "object" && !Array.isArray(raw.items) ? raw.items as Record<string, unknown> : {};
  for (const key of itemKeys) if (typeof savedItems[key] === "boolean") items[key] = savedItems[key] as boolean;
  const position = raw.position && typeof raw.position === "object" && !Array.isArray(raw.position) ? raw.position as Record<string, unknown> : {};
  return {
    targets,
    active: typeof raw.active === "string" ? raw.active : targets[0]?.id ?? "",
    interval: typeof raw.interval === "number" && raw.interval >= 2000 && raw.interval <= 30000 ? Math.round(raw.interval) : 3000,
    position: { x: typeof position.x === "number" ? position.x : 16, y: typeof position.y === "number" ? position.y : 56 },
    collapsed: raw.collapsed === true,
    items,
  };
}

const config = reactive(readConfig(props.context.config));
const position = reactive({ ...config.position });
const status = reactive<Status>({ online: false });
const settingsVisible = ref(false);
const copied = ref(false);
const freeing = ref(false);
const dragging = ref<{ startX: number; startY: number; originX: number; originY: number }>();
const collapsed = computed({
  get: () => config.collapsed,
  set: value => { config.collapsed = value; persist(); },
});
const bar = ref<HTMLElement>();
const activeTarget = computed(() => config.targets.find(target => target.id === config.active) ?? config.targets[0]);
const visibleItems = computed(() => itemKeys.filter(key => config.items[key]));

let timer: ReturnType<typeof setInterval> | undefined;
let saving: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let inFlight = false;

// ACT: 位置、显示项、目标全部落在同一个配置对象里，一次写入避免反复触发扩展配置刷新。
function saveNow() {
  props.context.saveConfig({
    targets: config.targets.map(target => ({ id: target.id, label: target.label, url: target.url })),
    active: config.active,
    interval: config.interval,
    position: { x: position.x, y: position.y },
    collapsed: config.collapsed,
    items: { ...config.items },
  }).catch(() => {});
}

function persist() {
  if (saving !== undefined) clearTimeout(saving);
  saving = setTimeout(() => { saving = undefined; saveNow(); }, 400);
}

function toggleCollapsed() { collapsed.value = !collapsed.value; }

// ACT: ComfyUI 的 /free 只设置队列 flag，任务执行中不会中断，清理会在该任务结束后生效。
async function freeVram() {
  const target = activeTarget.value;
  if (!target?.url || freeing.value) return;
  const before = gpu()?.vramUsed;
  freeing.value = true;
  try {
    const response = await fetch("/api/monitor/free", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-toonflow-workspace": "1" },
      body: JSON.stringify({ url: target.url }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.code !== 200) throw new Error(body?.message || `HTTP ${response.status}`);
    if ((status.queue?.running ?? 0) > 0) ElMessage.warning("当前有任务在运行，显存会在该任务结束后释放");
    await refresh();
    // 清理由执行线程异步完成，稍后再取一次数据用于对比。
    setTimeout(() => {
      void refresh().then(() => {
        const after = gpu()?.vramUsed;
        if (before !== undefined && after !== undefined && after < before) {
          ElMessage.success(`已释放 ${formatBytes(before - after)} 显存`);
        } else {
          ElMessage.info("已请求清理；如果占用没变化，可能是任务仍在运行或没有可释放的模型");
        }
      });
    }, 1800);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "清理显存失败");
  } finally {
    freeing.value = false;
  }
}

function addTarget() {
  const target: Target = { id: crypto.randomUUID(), label: `ComfyUI ${config.targets.length + 1}`, url: "" };
  config.targets.push(target);
  config.active = target.id;
  persist();
}

function targetChanged() {
  persist();
  // ACT: 改完地址立即重新取数，不用等下一个轮询周期。
  void refresh();
}

function removeTarget(id: string) {
  const index = config.targets.findIndex(target => target.id === id);
  if (index < 0) return;
  config.targets.splice(index, 1);
  if (config.active === id) config.active = config.targets[0]?.id ?? "";
  persist();
  void refresh();
}

async function refresh() {
  const target = activeTarget.value;
  if (!target?.url) { Object.assign(status, { online: false, error: "请先填写监控地址" }); return; }
  // ACT: 先判断在途请求再中止，避免同一次变更触发两次刷新时把请求中断却不重发。
  if (inFlight) return;
  controller?.abort();
  inFlight = true;
  const current = controller = new AbortController();
  try {
    const response = await fetch(`/api/monitor/status?url=${encodeURIComponent(target.url)}`, {
      headers: { "x-toonflow-workspace": "1" }, signal: current.signal, cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.code !== 200 || !body.data) throw new Error(body?.message || `HTTP ${response.status}`);
    Object.assign(status, { ...body.data, online: true, error: "" });
  } catch (error) {
    if (current.signal.aborted) return;
    Object.assign(status, { online: false, error: error instanceof Error ? error.message : "无法连接" });
  } finally {
    if (controller === current) { controller = undefined; inFlight = false; }
  }
}

function restartTimer() {
  if (timer !== undefined) clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, config.interval);
}

watch(() => [config.active, config.interval], () => { persist(); restartTimer(); void refresh(); });

function formatBytes(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const gb = value / 1024 ** 3;
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

function gpu(): Gpu | undefined { return status.gpus?.[0]; }

function isMissing(key: ItemKey) {
  if (!status.online) return false;
  const missing = new Set(status.missing ?? []);
  if (key === "cpu") return missing.has("cpuPercent") || status.system?.cpuPercent === undefined;
  if (key === "ram") return status.system?.ramTotal === undefined;
  if (key === "gpu") return missing.has("gpuUtil") || gpu()?.util === undefined;
  if (key === "temperature") return missing.has("temperature") || gpu()?.temperature === undefined;
  if (key === "power") return missing.has("power") || gpu()?.power === undefined;
  if (key === "vram") return gpu()?.vramTotal === undefined;
  if (key === "queue") return status.queue?.running === undefined && status.queue?.pending === undefined;
  return !status.system?.version;
}

function missingHint(key: ItemKey) {
  return ["cpu", "gpu", "temperature", "power"].includes(key) ? "需要安装采集脚本后才能读取" : "当前地址不提供该数据";
}

function percentOf(key: ItemKey) {
  if (key === "cpu") return status.system?.cpuPercent;
  if (key === "ram") return status.system?.ramPercent;
  if (key === "vram") return gpu()?.vramPercent;
  if (key === "gpu") return gpu()?.util;
  return undefined;
}

function levelClass(key: ItemKey) {
  const percent = percentOf(key) ?? 0;
  return percent >= 90 ? "danger" : percent >= 70 ? "warn" : "";
}

function itemText(key: ItemKey) {
  if (!status.online) return "—";
  if (isMissing(key)) return "不可用";
  switch (key) {
    case "cpu": return `${Math.round(status.system?.cpuPercent ?? 0)}%`;
    case "ram": return `${formatBytes(status.system?.ramUsed)}/${formatBytes(status.system?.ramTotal)}`;
    case "vram": return `${formatBytes(gpu()?.vramUsed)}/${formatBytes(gpu()?.vramTotal)}`;
    case "gpu": return `${Math.round(gpu()?.util ?? 0)}%`;
    case "temperature": return `${Math.round(gpu()?.temperature ?? 0)}°C`;
    case "power": return `${Math.round(gpu()?.power ?? 0)}W`;
    case "queue": return `${status.queue?.running ?? 0} / ${status.queue?.pending ?? 0}`;
    default: return status.system?.version ? `v${status.system.version}` : "—";
  }
}

async function copyScript() {
  await props.context.writeClipboardText(script);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 1600);
}

function clamp() {
  const parent = bar.value?.parentElement;
  if (!parent || !bar.value) return;
  const width = parent.clientWidth - bar.value.offsetWidth - 8;
  const height = parent.clientHeight - bar.value.offsetHeight - 8;
  position.x = Math.max(8, Math.min(position.x, Math.max(8, width)));
  position.y = Math.max(8, Math.min(position.y, Math.max(8, height)));
}

// ACT: 整条状态栏都可拖动；按钮、输入框等交互控件除外，避免点设置或清理时误拖。
const interactiveSelector = "button, a, input, textarea, select, .el-switch, .el-radio, .el-checkbox, .el-slider, .el-select, .el-popover, [role=\"slider\"]";
function startDragFromBar(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest(interactiveSelector)) return;
  startDrag(event);
}

function startDrag(event: PointerEvent) {
  if (event.button !== 0 || dragging.value) return;
  event.preventDefault();
  // ACT: 指针捕获在个别环境会抛错（例如非活跃指针）；失败不影响后续 window 监听。
  try { (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId); }
  catch { /* 忽略 */ }
  dragging.value = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end, { once: true });
  window.addEventListener("pointercancel", end, { once: true });
}
function move(event: PointerEvent) {
  const active = dragging.value;
  if (!active) return;
  position.x = active.originX + (event.clientX - active.startX);
  position.y = active.originY + (event.clientY - active.startY);
  clamp();
}
function end() {
  if (!dragging.value) return;
  dragging.value = undefined;
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointercancel", end);
  persist();
}

function onResize() { clamp(); }
onMounted(() => {
  void refresh();
  restartTimer();
  window.addEventListener("resize", onResize);
  // 等首帧渲染后按容器尺寸夹住位置，避免小窗口里跑到画布外。
  requestAnimationFrame(clamp);
});
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer);
  // ACT: 防抖期间卸载会丢掉最后一次位置/开关改动，卸载前立即落盘。
  if (saving !== undefined) { clearTimeout(saving); saving = undefined; saveNow(); }
  controller?.abort();
  window.removeEventListener("resize", onResize);
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointercancel", end);
});
</script>

<style scoped lang="scss">
.comfyMonitor {
  position: absolute;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  // ACT: 窗口变窄时折行而不是把芯片挤出画布；折行后最多占满画布高度，超出自身滚动。
  max-width: calc(100% - 16px);
  max-height: calc(100% - 16px);
  overflow: auto;
  padding: 5px 6px 5px 4px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: color-mix(in srgb, var(--el-bg-color-overlay) 92%, transparent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  color: var(--el-text-color-regular);
  font-size: 12px;
  pointer-events: auto;
  cursor: grab;
  user-select: none;

  &.dragging { cursor: grabbing; }

  button, input, .el-switch { cursor: pointer; }
  backdrop-filter: blur(8px);

  .handle {
    display: grid;
    place-items: center;
    width: 14px;
    height: 20px;
    color: var(--el-text-color-placeholder);
    cursor: grab;

    &:active { cursor: grabbing; }
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--el-color-success);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-success) 25%, transparent);
    flex: 0 0 auto;
  }

  &.offline .dot {
    background: var(--el-color-danger);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--el-color-danger) 25%, transparent);
  }

  .targetName {
    max-width: 140px;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--el-fill-color-light);
    white-space: nowrap;

    .chipLabel { color: var(--el-text-color-secondary); }
    .chipValue { font-variant-numeric: tabular-nums; }

    &.missing {
      opacity: 0.5;

      .chipValue { color: var(--el-text-color-placeholder); }
    }

    &.hint { color: var(--el-text-color-secondary); }

    &.error { color: var(--el-color-danger); }

    .bar {
      display: inline-block;
      width: 34px;
      height: 4px;
      border-radius: 2px;
      background: var(--el-fill-color-dark);
      overflow: hidden;

      i {
        display: block;
        height: 100%;
        border-radius: 2px;
        background: var(--el-color-primary);
        transition: width 0.3s ease;

        &.warn { background: var(--el-color-warning); }
        &.danger { background: var(--el-color-danger); }
      }
    }
  }

  .iconButton {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    cursor: pointer;

    &:hover { background: var(--el-fill-color-light); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }

    .spin { display: inline-block; animation: comfyMonitorSpin 1s linear infinite; }
  }

  &.collapsed .targetName { max-width: 120px; }
}

@keyframes comfyMonitorSpin { to { transform: rotate(360deg); } }

.settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;

  .sectionTitle {
    margin-top: 4px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .targetRow {
    display: grid;
    grid-template-columns: auto 90px minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
  }

  .itemGrid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px 8px;
  }

  .hintText {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.5;
  }

  .scriptActions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
</style>
