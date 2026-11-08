<template>
  <el-dialog
    v-model="visible"
    :title="translate('保存到素材库')"
    width="min(460px, calc(100vw - 24px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving">
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item :label="translate('目标素材库')">
        <el-radio-group v-model="targetLibrary" :aria-label="translate('目标素材库')" :disabled="saving" @change="onTargetLibraryChange">
          <el-radio-button value="project" :disabled="!directory">{{ translate("本项目") }}</el-radio-button>
          <el-radio-button value="global">{{ translate("全局") }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item :label="translate('保存位置')">
        <AssetDestinationTree
          :key="destinationKey"
          v-model="destination"
          class="saveDestination"
          :library="targetLibrary"
          :directory="directory"
          :root-label="rootLabel"
          allow-create
          @error="error = $event" />
      </el-form-item>
      <el-form-item :label="translate('将保存的素材')">
        <div class="batchPreview">
          <span class="batchCount">{{ translate("共 {count} 个素材", { count: items.length }) }}</span>
          <!-- ACT: 列表与真实写入共用 prepareSelectionAssets 生成的名字，重名自动改名只发生在服务端抢名时。 -->
          <ul class="batchNames" aria-live="polite">
            <li v-for="item in items" :key="item.node.id" :title="item.name">{{ item.name }}</li>
          </ul>
        </div>
      </el-form-item>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">{{ translate("取消") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">
        {{ translate("保存 {count} 个素材", { count: items.length }) }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { translate } from "@toonflow/i18n/vue";
import AssetDestinationTree from "@/pages/workspace/panels/assetLibrary/components/AssetDestinationTree.vue";
import { useSaveDestination } from "@/pages/workspace/panels/assetLibrary/components/useSaveDestination";
import { toAssetError } from "@/pages/workspace/panels/assetLibrary/api";
import type { PreparedAsset } from "../selectionAssets";
import { saveSelectionToAssets, type SaveSelectionToAssetsResult } from "../saveSelectionToAssets";

const props = defineProps<{ directory?: string }>();
const emit = defineEmits<{
  saved: [result: SaveSelectionToAssetsResult, target: { library: "project" | "global"; path: string }];
}>();

const visible = ref(false);
// ACT: GraphNode 的递归泛型经 ref 深解包会触发 TS2589，且这里只整体替换/读取，不需要深响应。
const items = shallowRef<PreparedAsset[]>([]);
const saving = ref(false);
const {
  targetLibrary, destination, destinationKey, error, restore, switchLibrary, remember,
} = useSaveDestination({
  // ACT: 批量入口不依赖素材库面板当前浏览的库，无记忆时统一回落项目库（无项目则全局库）根目录。
  library: () => (props.directory ? "project" : "global"),
  directory: () => props.directory,
});
const rootLabel = computed(() => targetLibrary.value === "project" ? translate("本项目素材库根目录") : translate("全局素材库根目录"));
const canSave = computed(() => !!props.directory && items.value.length > 0
  && items.value.every(item => !!item.source) && !saving.value);

/** 打开时快照选中集合：弹窗期间画布选区变化不影响本次写入范围。 */
function open(selection: PreparedAsset[]) {
  items.value = [...selection];
  restore("");
  visible.value = true;
}

function onTargetLibraryChange() {
  switchLibrary("");
}

async function save() {
  if (!canSave.value) return;
  // ACT: 保存期间用户可能改选目标；请求与记忆都用点击时的快照。
  const saveLibrary = targetLibrary.value;
  const saveDestination = destination.value;
  const snapshot = [...items.value];
  saving.value = true;
  error.value = "";
  try {
    const result = await saveSelectionToAssets(snapshot, props.directory ?? "", { library: saveLibrary, path: saveDestination });
    // ACT: 全部失败时留在弹窗里显示原因，用户可以改位置重试；部分成功才关闭并汇总。
    if (!result.saved && result.failed.length) {
      const first = result.failed[0]!;
      error.value = translate("失败 {count} 个：{label}（{reason}）", {
        count: result.failed.length, label: first.label, reason: first.reason,
      });
      return;
    }
    // 全部失败时不记住落点，避免下一次继续回填一个写不进去的位置。
    if (result.saved > 0) remember(saveLibrary, saveDestination);
    visible.value = false;
    emit("saved", result, { library: saveLibrary, path: saveDestination });
  } catch (cause) {
    error.value = toAssetError(cause).message;
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<style scoped lang="scss">
.saveDestination { width: 100%; }

.batchPreview {
  width: 100%;

  .batchCount {
    display: block;
    margin-bottom: 4px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .batchNames {
    max-height: 160px;
    margin: 0;
    padding: 6px 8px;
    overflow-y: auto;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 4px;
    background: var(--el-fill-color-lighter);
    list-style: none;
    font-family: var(--el-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 12px;
    line-height: 1.6;

    li {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
}
</style>
