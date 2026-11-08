<template>
  <el-dialog
    v-model="visible"
    :title="translate('保存到素材库')"
    width="min(460px, calc(100vw - 24px))"
    align-center
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    @opened="nameInput?.select()">
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item :label="translate('素材名称')">
        <el-input
          ref="nameInput"
          v-model="name"
          :aria-label="translate('素材名称')"
          :placeholder="translate('输入完整文件名')"
          :disabled="saving"
          @keydown.enter.prevent="save" />
      </el-form-item>
      <el-form-item v-if="outputs.length > 1" :label="translate('节点输出')">
        <el-select v-model="selectedOutput" :aria-label="translate('节点输出')" :disabled="saving">
          <el-option v-for="(item, index) in outputs" :key="index" :label="item.label" :value="index" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="allowLibrarySwitch" :label="translate('目标素材库')">
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
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    </el-form>
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">{{ translate("取消") }}</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">{{ translate("保存") }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { InputInstance } from "element-plus";
import type { NodeOutput } from "@toonflow/nodes-scaffold/values";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import AssetDestinationTree from "./AssetDestinationTree.vue";
import { useSaveDestination } from "./useSaveDestination";
import { importAsset, toAssetError, uploadAsset } from "../api";
import { joinAssetPath } from "../types";
import type { AssetLibraryKind } from "../types";

type Output = { label: string; output: NodeOutput };

const props = withDefaults(defineProps<{
  library: AssetLibraryKind;
  directory?: string;
  currentPath: string;
  sourceDirectory?: string;
  /** 收藏入口需要同时选择目标库；节点产物保存仍沿用当前库。 */
  allowLibrarySwitch?: boolean;
}>(), { allowLibrarySwitch: false });
const emit = defineEmits<{ saved: [path: string, library: AssetLibraryKind] }>();

const visible = ref(false);
const outputs = ref<Output[]>([]);
const selectedOutput = ref(0);
const name = ref("");
const saving = ref(false);
const nameInput = ref<InputInstance>();
const {
  targetLibrary, destination, destinationKey, error, restore, switchLibrary, remember,
} = useSaveDestination({ library: () => props.library, directory: () => props.directory });
/** 工作区来源（对话附件）走 /api/assets/import，不再读取成 Blob 上传。 */
const workspaceSource = ref<{ path: string }>();
const rootLabel = computed(() => targetLibrary.value === "project" ? translate("本项目素材库根目录") : translate("全局素材库根目录"));
let previousExtension = "";

const extension = computed(() => {
  const output = outputs.value[selectedOutput.value]?.output;
  if (!output) return "";
  if (typeof output.value !== "object" || output.value === null) return output.dataType === "STRING" ? ".txt" : ".json";
  return output.value.url.match(/\.[^./\\]+$/)?.[0] ?? "";
});
const canSave = computed(() => !!name.value.trim() && !/[\\/]/.test(name.value) && !saving.value
  && (!!workspaceSource.value || !!props.sourceDirectory));

function open(label: string, items: Output[]) {
  workspaceSource.value = undefined;
  outputs.value = items;
  selectedOutput.value = 0;
  previousExtension = extension.value;
  name.value = label.endsWith(extension.value) ? label : `${label}${extension.value}`;
  restore(props.currentPath);
  visible.value = true;
}

/** 对话附件收藏：source.kind=workspace，path 为 assets/chat/... 工作区相对路径。 */
function openWorkspaceFile(path: string, fileName: string) {
  workspaceSource.value = { path };
  outputs.value = [];
  selectedOutput.value = 0;
  previousExtension = "";
  name.value = fileName;
  restore("");
  visible.value = true;
}

function onTargetLibraryChange() {
  switchLibrary(props.currentPath);
}

watch(selectedOutput, () => {
  const nextExtension = extension.value;
  if (nextExtension && name.value.endsWith(previousExtension)) {
    name.value = `${name.value.slice(0, name.value.length - previousExtension.length)}${nextExtension}`;
  }
  previousExtension = nextExtension;
});

async function save() {
  const fileName = name.value.trim();
  if (!fileName || !canSave.value) return;
  // ACT: 慢上传期间用户可能关掉弹窗再发起另一次保存；请求与记忆都必须用点击时的快照，
  // 否则第一次请求完成后会把第二次打开时的选择写进记忆。
  const saveLibrary = targetLibrary.value;
  const saveDestination = destination.value;
  saving.value = true;
  error.value = "";
  try {
    if (workspaceSource.value) {
      const result = await importAsset(
        { library: saveLibrary, directory: props.directory },
        { kind: "workspace", path: workspaceSource.value.path },
        { targetDir: saveDestination, name: fileName },
      );
      remember(saveLibrary, saveDestination);
      visible.value = false;
      emit("saved", result.path, saveLibrary);
      return;
    }
    const output = outputs.value[selectedOutput.value]?.output;
    if (!output) return;
    const content = typeof output.value === "object" && output.value !== null
      ? await useWorkspaceFiles(() => props.sourceDirectory).read(output.value.url)
      : new Blob([String(output.value)]);
    const blob = content instanceof Blob ? content : new Blob([content]);
    let attempt = 0;
    while (attempt < 50) {
      const dot = fileName.lastIndexOf(".");
      const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
      const suffix = dot > 0 ? fileName.slice(dot) : "";
      const candidate = attempt === 0 ? fileName : `${stem} (${attempt + 1})${suffix}`;
      try {
        const result = await uploadAsset({ library: saveLibrary, directory: props.directory }, joinAssetPath(saveDestination, candidate), blob);
        remember(saveLibrary, saveDestination);
        visible.value = false;
        emit("saved", result.path, saveLibrary);
        return;
      } catch (cause) {
        const info = toAssetError(cause);
        if (info.code === "EEXIST") { attempt++; continue; }
        throw cause;
      }
    }
    throw new Error(translate("同名文件过多，无法确定可用名称"));
  } catch (cause) {
    error.value = toAssetError(cause).message;
  } finally {
    saving.value = false;
  }
}

defineExpose({ open, openWorkspaceFile });
</script>

<style scoped lang="scss">
.saveDestination { width: 100%; }
</style>
