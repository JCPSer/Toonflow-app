<template>
  <mini-map
    v-if="showMap && (active ?? true)"
    class="canvasMiniMap"
    position="bottom-left"
    :pannable="true"
    :zoomable="true"
    node-color="var(--el-fill-color-dark)"
    mask-color="var(--el-mask-color-extra-light)"
    @click="onMiniMapClick" />
  <panel class="canvasControlsPanel" position="bottom-left">
    <el-card class="canvasControlsCard" shadow="never" :bodyStyle="{ padding: '2px 4px' }">
      <div class="canvasControls">
        <el-tooltip :showArrow="false" :content="assetsVisible ? '关闭素材库' : '打开素材库'" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button
            class="toolButton"
            text
            :type="assetsVisible ? 'primary' : 'default'"
            :aria-pressed="assetsVisible"
            aria-label="素材库"
            @click="assetsVisible = !assetsVisible">
            <icon-folders :size="18" />
          </el-button>
        </el-tooltip>
        <!-- trigger 用 contextmenu 是为了让整理按钮只由 arrangeNodes 控制显隐，同时仍保留点击外部自动关闭 -->
        <el-tooltip :showArrow="false" content="整理画布" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]" :disabled="undoPopoverVisible">
          <span class="toolTrigger">
            <el-popover trigger="contextmenu" placement="top-start" :width="180" v-model:visible="undoPopoverVisible">
              <template #reference>
                <el-button class="toolButton" text :disabled="!canArrange" aria-label="整理画布" @click="arrangeNodes">
                  <icon-sitemap :size="18" />
                </el-button>
              </template>
              <div class="zoomMenu">
                <el-button class="zoomAction" style="width: 100%" text @click="undoArrange">撤销整理</el-button>
              </div>
            </el-popover>
          </span>
        </el-tooltip>
        <el-tooltip :showArrow="false" :content="showMap ? '隐藏地图' : '显示地图'" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button
            class="toolButton"
            text
            :type="showMap ? 'primary' : 'default'"
            :aria-pressed="showMap"
            aria-label="显示或隐藏地图"
            @click="showMap = !showMap">
            <icon-map :size="18" />
          </el-button>
        </el-tooltip>
        <el-tooltip :showArrow="false" :content="snapEnabled ? '关闭网格吸附' : '开启网格吸附'" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button
            class="toolButton"
            text
            :type="snapEnabled ? 'primary' : 'default'"
            :aria-pressed="snapEnabled"
            aria-label="网格吸附"
            @click="snapEnabled = !snapEnabled">
            <icon-magnet :size="18" />
          </el-button>
        </el-tooltip>
        <el-tooltip :showArrow="false" :content="showEdges ? '隐藏连线' : '显示连线'" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button
            class="toolButton"
            text
            :type="showEdges ? 'primary' : 'default'"
            :aria-pressed="showEdges"
            aria-label="显示或隐藏连线"
            @click="showEdges = !showEdges">
            <icon-arrow-guide :size="18" />
          </el-button>
        </el-tooltip>
        <el-tooltip :showArrow="false" content="适应视图" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]">
          <el-button class="toolButton" text aria-label="适应视图" @click="fitView()">
            <icon-focus-centered :size="18" />
          </el-button>
        </el-tooltip>
        <el-tooltip :showArrow="false"
          content="缩放菜单（滚轮调整缩放）"
          placement="top"
          :hideAfter="0"
          :enterable="false"
          :triggerKeys="[]"
          :disabled="zoomMenuVisible">
          <span class="toolTrigger">
            <el-popover v-model:visible="zoomMenuVisible" trigger="click" placement="top-start" :width="216">
              <template #reference>
                <el-button
                  class="toolButton"
                  text
                  aria-label="缩放菜单"
                  @wheel.stop.prevent="$event.deltaY && applyZoom(Math.min(800, Math.max(20, zoomPercent - Math.sign($event.deltaY))))">
                  {{ zoomPercent }}%
                </el-button>
              </template>
              <div class="zoomMenu">
                <el-input-number
                  class="zoomInput"
                  :model-value="zoomPercent"
                  :min="20"
                  :max="800"
                  :controls="false"
                  aria-label="缩放百分比"
                  @change="applyZoom">
                  <template #suffix>%</template>
                </el-input-number>
                <el-button class="zoomAction" text @click="zoomIn()">放大</el-button>
                <el-button class="zoomAction" text @click="zoomOut()">缩小</el-button>
                <el-button class="zoomAction" text @click="fitView()">适合屏幕</el-button>
              </div>
            </el-popover>
          </span>
        </el-tooltip>
      </div>
    </el-card>
  </panel>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Panel, useVueFlow, type XYPosition } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import { IconMap, IconMagnet, IconFocusCentered } from "@tabler/icons-vue";
import { ElMessage } from "element-plus";
import { arrangeCanvas } from "../arrangeCanvas";

const props = defineProps<{
  canvasId: string;
  directory: string | undefined;
  batchHistory: (action: () => Promise<void>) => Promise<void>;
  /** 非当前画布实例（canvasHost 会保留挂载）不渲染小地图，只跟随持久化的开关值。 */
  active?: boolean;
}>();
const snapEnabled = defineModel<boolean>("snapEnabled", { required: true });
const showEdges = defineModel<boolean>("showEdges", { required: true });
const assetsVisible = defineModel<boolean>("assetsVisible", { default: false });
const showMap = defineModel<boolean>("showMap", { required: true });
const zoomMenuVisible = ref(false);
const flow = useVueFlow();
const { viewport, zoomTo, zoomIn, zoomOut, fitView, getNodes, updateNode, setCenter } = flow;
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100));
const layoutSnapshot = ref<{ id: string; position: XYPosition }[]>();
const undoPopoverVisible = ref(false);
const arranging = ref(false);
let arrangeController: AbortController | undefined;
const canArrange = computed(() => {
  const nodes = getNodes.value.filter((node) => !node.parentNode);
  return (
    !!props.canvasId &&
    !!props.directory &&
    !arranging.value &&
    nodes.length > 0 &&
    nodes.every((node) => node.dimensions.width > 0 && node.dimensions.height > 0)
  );
});
defineExpose({ arrangeNodes });

watch(
  () => [props.canvasId, props.directory],
  () => {
    arrangeController?.abort();
    layoutSnapshot.value = undefined;
    undoPopoverVisible.value = false;
  },
  { flush: "sync" }
);
onBeforeUnmount(() => arrangeController?.abort());

// ACT: 小地图此前只能拖动视口框，点击空白处没有反应。点击即把它对应的画布位置移到屏幕中心。
// 坐标从 SVG 的 viewBox 反算——组件 emit 的 position 是小地图自身像素坐标，换算规则属于实现细节；
// preserveAspectRatio 默认 xMidYMid meet，等比缩放后会有留白，必须把留白扣掉才对得上。
function onMiniMapClick(payload: { event: MouseEvent }) {
  const target = payload?.event?.target;
  const svg = target instanceof Element ? target.closest("svg") : null;
  if (!svg) return;
  const box = svg.viewBox.baseVal;
  const rect = svg.getBoundingClientRect();
  if (!box || !box.width || !box.height || !rect.width || !rect.height) return;
  const scale = Math.min(rect.width / box.width, rect.height / box.height);
  if (!scale) return;
  const x = box.x + (payload.event.clientX - rect.left - (rect.width - box.width * scale) / 2) / scale;
  const y = box.y + (payload.event.clientY - rect.top - (rect.height - box.height * scale) / 2) / scale;
  void setCenter(x, y, { zoom: viewport.value.zoom, duration: 180 });
}

function applyZoom(value: number | undefined) {
  if (value !== undefined && Number.isFinite(value)) void zoomTo(value / 100);
}

async function arrangeNodes() {
  if (!canArrange.value) return;
  const controller = new AbortController();
  arrangeController = controller;
  arranging.value = true;
  try {
    await props.batchHistory(async () => {
      const { snapshot, arrangedNodeIds } = await arrangeCanvas(flow, controller.signal);
      controller.signal.throwIfAborted();
      if (!arrangedNodeIds.length) return;
      layoutSnapshot.value = snapshot;
      undoPopoverVisible.value = true;
    });
  } catch (error) {
    if (!controller.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "整理画布失败");
  } finally {
    arrangeController = undefined;
    arranging.value = false;
  }
}

async function undoArrange() {
  const snapshot = layoutSnapshot.value;
  if (!snapshot) return;
  try {
    await props.batchHistory(async () => {
      const nodeIds = new Set(getNodes.value.map((node) => node.id));
      snapshot.forEach(({ id, position }) => {
        if (nodeIds.has(id)) updateNode(id, { position });
      });
      layoutSnapshot.value = undefined;
      undoPopoverVisible.value = false;
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "撤销整理失败");
  }
}
</script>

<style lang="scss" scoped>
.canvasMiniMap.vue-flow__minimap {
  bottom: 46px;
  /* ACT: 可点击跳转要有可发现的指针反馈；拖动过程中仍由组件内的 grab 光标接管。 */
  cursor: pointer;
}

@container canvasWorkspace (max-width: 1040px) {
  .canvasControlsPanel.vue-flow__panel { bottom: 46px; }
  .canvasMiniMap.vue-flow__minimap { bottom: 92px; }
}

.canvasControlsCard { height: 34px; box-sizing: border-box; }

.canvasControls {
  display: flex;
  align-items: center;
  gap: 2px;

  .toolTrigger {
    display: inline-flex;
  }

  .toolButton {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    margin-left: 0;
    padding: 0;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
}

.zoomMenu {
  display: flex;
  flex-direction: column;

  .zoomInput {
    width: 100%;
  }

  .zoomAction {
    justify-content: flex-start;
    margin-left: 0;
  }
}
</style>
