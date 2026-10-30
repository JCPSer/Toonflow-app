<template>
  <nodeSkeleton
    v-bind="nodeProps"
    :topVisible="node.selected"
    :bottomVisible="node.selected && (lightingVisible || multiAngleVisible || editor?.mode === 'inpaint')"
    :bottomWidth="660"
    topWidth="max-content"
    :downloadUrl="previewUrl"
    :busy="cropping || uploading || scaling || !!editor?.busy || !!lighting?.generating || !!multiAngle?.generating || !!panorama?.busy || !!gridSplit?.splitting || !!inpaintPrompt?.creating"
    :downloadName="outputFile?.url.split(/[\\/]/).at(-1)"
    @fullscreen="previewVisible = true"
    :style="{ width: (previewUrl || thumbUrl) && imageWidth ? `${imageWidth + 18}px` : undefined }">
    <template v-if="editor?.mode" #top><div ref="paintToolbar" /></template>
    <template #topActions>
      <el-button class="panoramaButton" :icon="IconPanoramaHorizontal" :disabled="cropping || scaling || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting || inpaintPrompt?.creating || panorama?.busy || !previewUrl" text title="全景图" aria-label="全景图" @click.stop="panorama?.open($event)">全景图<icon-chevron-down class="menuChevron" :size="14" /></el-button>
      <el-button :icon="IconBrush" :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="局部重绘" aria-label="局部重绘" @click.stop="startEditor('inpaint')">局部重绘</el-button>
      <el-button :icon="IconSun" :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="打光" aria-label="打光" @click.stop="openLighting">打光</el-button>
      <el-button :icon="IconCameraRotate" :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="多角度" aria-label="多角度" @click.stop="openMultiAngle">多角度</el-button>
      <el-button :icon="IconLayoutGrid" :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl" :loading="gridSplit?.splitting" text title="宫格切分" aria-label="宫格切分" @click.stop="gridSplit?.open($event)">宫格切分</el-button>
      <el-button :icon="IconCrop" :disabled="cropping || scaling || uploading || editor?.busy || !!editor?.mode || lighting?.generating || multiAngle?.generating || panorama?.busy || gridSplit?.splitting || inpaintPrompt?.creating || !previewUrl" :loading="cropping" text title="裁剪" aria-label="裁剪" @click.stop="crop?.open()">裁剪</el-button>
      <el-button :icon="IconResize" :disabled="cropping || uploading || editor?.busy || !!editor?.mode || lighting?.generating || multiAngle?.generating || panorama?.busy || gridSplit?.splitting || inpaintPrompt?.creating || !previewUrl" :aria-expanded="scale?.visible ?? false" text title="缩放" aria-label="缩放" @click.stop="scale?.open($event)">缩放</el-button>
      <el-button
        :icon="IconTransfer"
        :loading="uploading"
        :disabled="cropping || scaling || editor?.busy || inpaintPrompt?.creating || gridSplit?.splitting || lighting?.generating || multiAngle?.generating || panorama?.busy"
        text
        title="替换图片"
        aria-label="替换图片"
        @click.stop="fileInput?.click()">替换图片</el-button>
    </template>
    <template #topRightActions>
      <el-button :icon="IconPencil" :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy || !previewUrl || gridSplit?.splitting" text title="标记" aria-label="标记" @click.stop="startEditor('mark')" />
    </template>
    <div class="imageContent nopan">
      <imageEditor
        v-if="previewUrl || thumbUrl"
        ref="editor"
        :src="previewUrl"
        :previewSrc="thumbUrl"
        :toolbarTarget="paintToolbar"
        :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy"
        alt="节点图片"
        @load="resizeImage"
        @error="ElMessage.error('无法预览该图片')" />
      <input ref="fileInput" class="fileInput" type="file" accept="image/*" aria-label="选择图片" :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy" @change="uploadImage" />
      <el-button
        v-if="!outputFile"
        class="uploadButton"
        text
        :loading="uploading"
        title="上传图片"
        aria-label="上传图片"
        @dblclick.stop
        @click="fileInput?.click()">
        <icon-upload v-if="!uploading" :size="48" stroke="1.5" />
      </el-button>
    </div>
    <template v-if="lightingVisible || multiAngleVisible || editor?.mode === 'inpaint'" #bottom>
      <div v-if="lightingVisible" ref="lightingTarget" />
      <div v-else-if="multiAngleVisible" ref="multiAngleTarget" />
      <div v-else ref="inpaintTarget" />
    </template>
  </nodeSkeleton>
  <imageInpaintPrompt v-if="editor?.mode === 'inpaint'" ref="inpaintPrompt" :target="inpaintTarget" :createDraft="createInpaint" :disabled="cropping || scaling || uploading" />
  <imageLighting v-if="lightingVisible" ref="lighting" :src="previewUrl" :source="outputFile" :target="lightingTarget" :disabled="cropping || scaling || uploading || gridSplit?.splitting" @close="lightingVisible = false" />
  <imageMultiAngle v-if="multiAngleVisible" ref="multiAngle" :src="previewUrl" :source="outputFile" :target="multiAngleTarget" :disabled="cropping || scaling || uploading || gridSplit?.splitting" @close="multiAngleVisible = false" />
  <imagePanorama ref="panorama" :src="previewUrl" :source="outputFile" :disabled="cropping || scaling || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting || inpaintPrompt?.creating" @open="openPanorama" />
  <imageGridSplit ref="gridSplit" :src="previewUrl" :disabled="cropping || scaling || uploading || lighting?.generating || multiAngle?.generating || panorama?.busy" :active="node.selected" />
  <imageScale ref="scale" :src="previewUrl" :source="outputFile" :active="node.selected" :disabled="cropping || uploading || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting || inpaintPrompt?.creating || panorama?.busy" @applied="handleScaleApplied" @restore="handleScaleRestore" />
  <imageCrop ref="crop" :src="previewUrl" :source="outputFile" :active="node.selected" :disabled="uploading || scaling || editor?.busy || lighting?.generating || multiAngle?.generating || gridSplit?.splitting || inpaintPrompt?.creating || panorama?.busy" @applied="handleCropApplied" @restore="handleCropRestore" />
  <el-image-viewer
    v-if="previewVisible && previewUrl"
    :urlList="[previewUrl]"
    teleported
    @close="previewVisible = false" />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { IconPhoto, IconUpload, IconTransfer, IconLayoutGrid, IconBrush, IconPencil, IconSun, IconCameraRotate, IconPanoramaHorizontal, IconChevronDown, IconResize, IconCrop } from "@tabler/icons-vue";
import { ElButton, ElImageViewer, ElMessage } from "element-plus";
import { nodeSkeleton, nodeTools, useNode, z, type NodeHandle } from "@toonflow/nodes-scaffold/runtime";
import imageGridSplit from "./components/imageGridSplit.vue";
import imageCrop from "./components/imageCrop.vue";
import imageScale from "./components/imageScale.vue";
import imageEditor from "./components/imageEditor.vue";
import imageInpaintPrompt from "./components/imageInpaintPrompt.vue";
import imageLighting from "./components/imageLighting.vue";
import imagePanorama from "./components/imagePanorama.vue";
import imageMultiAngle from "./components/imageMultiAngle.vue";
import type { InpaintDraftInput } from "./imageInpaint";

type ScalePrevious = { url: string; mimeType: string };
type ScaleState = { factor?: number; maxEdge?: number; previous?: ScalePrevious; appliedUrl?: string };
type ScaleApplied = { path: string; mimeType: string; fromUrl: string; formatChanged: boolean; width: number; height: number };
type CropState = { last?: { url: string; x: number; y: number; width: number; height: number }; previous?: ScalePrevious; appliedUrl?: string };
type CropApplied = { path: string; mimeType: string; fromUrl: string; formatChanged: boolean; width: number; height: number; flipped: boolean; cropped: boolean };

defineOptions({
  inheritAttrs: false,
  icon: IconPhoto,
  handles: [
    { id: "in", type: "target", dataType: "IMAGE", label: "来源图片" },
    { id: "image", type: "source", dataType: "IMAGE", label: "图片输出" },
  ] satisfies NodeHandle[],
});
const { node, nodeProps, outputs, nodeEvent, files, updateNodeInternals } = useNode({
  label: "图片",
});
const fileInput = ref<HTMLInputElement>();
const gridSplit = ref<InstanceType<typeof imageGridSplit>>();
const crop = ref<InstanceType<typeof imageCrop>>();
const scale = ref<InstanceType<typeof imageScale>>();
const editor = ref<InstanceType<typeof imageEditor>>();
const paintToolbar = ref<HTMLElement>();
const inpaintPrompt = ref<InstanceType<typeof imageInpaintPrompt>>();
const inpaintTarget = ref<HTMLElement>();
const lighting = ref<InstanceType<typeof imageLighting>>();
const lightingTarget = ref<HTMLElement>();
const lightingVisible = ref(false);
const multiAngle = ref<InstanceType<typeof imageMultiAngle>>();
const multiAngleTarget = ref<HTMLElement>();
const multiAngleVisible = ref(false);
const panorama = ref<InstanceType<typeof imagePanorama>>();
const uploading = ref(false);
const previewVisible = ref(false);
const imageWidth = ref(0);

const outputFile = computed(() => outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined);
const previewUrl = files.useFileUrl(
  outputFile,
  (error) => showError(error, "图片读取失败")
);
// ACT: 画布卡片只解码缩略图（原图 3072×4096 解码会阻塞主线程约 160ms）；编辑/导出仍用 previewUrl。
const thumbUrl = files.useThumbUrl(outputFile);
// ACT: 输出变化即预热缩略图，下次打开画布直接命中服务端缓存。
watch(thumbUrl, url => {
  const file = outputFile.value;
  if (!url || !file) return;
  try { files.getWorkspaceFiles().warmThumb?.(file.url, 1024); } catch {}
});
const scaling = computed(() => !!scale.value?.applying);
const cropping = computed(() => !!crop.value?.applying);

nodeEvent.on("save", (reason) => {
  // ACT: 删除节点会先触发一次无 reason 的 save；缩放中放行，让 delete 回调先取消任务再清理。
  if (scaling.value) {
    if (reason === "reload") throw new Error("图片处理中，请完成后再刷新节点");
    return;
  }
  if (cropping.value || uploading.value || editor.value?.busy || inpaintPrompt.value?.creating || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy) throw new Error("图片处理中，请完成后再切换或刷新节点");
});
nodeEvent.on("delete", async () => {
  // ACT: 缩放会写盘，删除前先中止并等任务收尾，避免半成品文件与节点目录清理竞争。
  await scale.value?.cancel();
  await crop.value?.cancelApply();
  if (cropping.value || uploading.value || editor.value?.busy || inpaintPrompt.value?.creating || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy) throw new Error("图片处理中，请稍后删除节点");
  uploading.value = true;
  await files.removeNodeFiles().finally(() => {
    uploading.value = false;
  });
});

nodeTools.register({
  name: "setImage",
  description: "选择工作区内已有的图片文件作为此节点的输出，path 使用工作区相对路径",
  parameters: z.strictObject({
    path: z.string().min(1).max(4096),
    mimeType: z.string().regex(/^image\/[a-zA-Z0-9.+-]+$/),
  }),
  async execute({ path, mimeType }, { signal }) {
    signal?.throwIfAborted();
    if (cropping.value || scaling.value || uploading.value || editor.value?.busy || inpaintPrompt.value?.creating || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy) throw new Error("图片处理中，请稍后重试");
    uploading.value = true;
    try {
      const content = await files.getWorkspaceFiles().read(path);
      signal?.throwIfAborted();
      if (!content.byteLength || content.byteLength > 100 * 1024 * 1024) throw new Error("图片不能为空且不能超过 100 MB");
      outputs.value.image = { dataType: "IMAGE", value: { url: path, mimeType } };
      clearScaleHistory();
      clearCropHistory();
      return outputs.value.image;
    } finally {
      uploading.value = false;
    }
  },
});

async function resizeImage(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (!image.naturalWidth || !image.naturalHeight) return;
  imageWidth.value = 240 * image.naturalWidth / image.naturalHeight;
  await nextTick();
  updateNodeInternals();
}

function openPanorama() {
  editor.value?.cancel();
  lightingVisible.value = false;
  multiAngleVisible.value = false;
}

function openLighting() {
  if (scaling.value || uploading.value || editor.value?.busy || inpaintPrompt.value?.creating || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting || !previewUrl.value) return;
  editor.value?.cancel();
  multiAngleVisible.value = false;
  lightingVisible.value = true;
}

function openMultiAngle() {
  if (scaling.value || uploading.value || editor.value?.busy || inpaintPrompt.value?.creating || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting || !previewUrl.value) return;
  editor.value?.cancel();
  lightingVisible.value = false;
  multiAngleVisible.value = true;
}

function startEditor(mode: "inpaint" | "mark") {
  if (scaling.value || uploading.value || editor.value?.busy || inpaintPrompt.value?.creating || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy || gridSplit.value?.splitting) return;
  lightingVisible.value = false;
  multiAngleVisible.value = false;
  editor.value?.start(mode);
}

async function createInpaint(input: InpaintDraftInput, signal: AbortSignal) {
  if (!editor.value) throw new Error("请先进入局部重绘");
  await editor.value.createInpaint(input, signal);
}

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || scaling.value || uploading.value || editor.value?.busy || inpaintPrompt.value?.creating || lighting.value?.generating || multiAngle.value?.generating || panorama.value?.busy) return;
  if (!file.type.startsWith("image/")) return void ElMessage.error("请选择图片文件");
  if (!file.size || file.size > 100 * 1024 * 1024) return void ElMessage.error("图片不能为空且不能超过 100 MB");
  uploading.value = true;
  try {
    const url = await files.uploadFile(file);
    // ACT: 复制节点可能仍引用旧图片，替换输出不删除共享文件。
    outputs.value.image = { dataType: "IMAGE", value: { url, mimeType: file.type } };
    clearScaleHistory();
    clearCropHistory();
  } catch (error) {
    showError(error, "图片替换失败");
  } finally {
    uploading.value = false;
  }
}

function scaleState(): ScaleState {
  const data = node.data as typeof node.data & { scale?: ScaleState };
  if (!data.scale || typeof data.scale !== "object" || Array.isArray(data.scale)) data.scale = {};
  return data.scale;
}

// ACT: 上传或 AI 改写输出后，旧的缩放记录已无法恢复，必须一并清掉，避免留下永远点不动的「恢复缩放前」。
function clearScaleHistory() {
  const data = node.data as typeof node.data & { scale?: ScaleState };
  if (!data.scale || typeof data.scale !== "object" || Array.isArray(data.scale)) return;
  delete data.scale.previous;
  delete data.scale.appliedUrl;
}

function handleScaleApplied(result: ScaleApplied) {
  const current = outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined;
  if (!current || current.url !== result.fromUrl) {
    // ACT: 缩放期间输出可能被 AI 或上传改写；放弃本次结果并尽力删除新文件。
    void files.getWorkspaceFiles().remove(result.path).catch(() => {});
    ElMessage.warning("图片已变化，已取消本次缩放");
    return;
  }
  const state = scaleState();
  state.previous = { url: current.url, mimeType: current.mimeType };
  state.appliedUrl = result.path;
  outputs.value.image = { dataType: "IMAGE", value: { url: result.path, mimeType: result.mimeType } };
  ElMessage.success(`已缩放为 ${result.width} × ${result.height}${result.formatChanged ? "，已转为 PNG" : ""}`);
}

function handleScaleRestore() {
  const current = outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined;
  const state = scaleState();
  const previous = state.previous;
  if (!current || !previous || current.url !== state.appliedUrl) return;
  outputs.value.image = { dataType: "IMAGE", value: { url: previous.url, mimeType: previous.mimeType } };
  delete state.previous;
  delete state.appliedUrl;
  ElMessage.success("已恢复缩放前的图片");
}

function cropState(): CropState {
  const data = node.data as typeof node.data & { crop?: CropState };
  if (!data.crop || typeof data.crop !== "object" || Array.isArray(data.crop)) data.crop = {};
  return data.crop;
}

// ACT: 与缩放同源——输出被上传或 AI 改写后，裁剪记录已无法恢复，必须一并清掉。
function clearCropHistory() {
  const data = node.data as typeof node.data & { crop?: CropState };
  if (!data.crop || typeof data.crop !== "object" || Array.isArray(data.crop)) return;
  delete data.crop.previous;
  delete data.crop.appliedUrl;
  delete data.crop.last;
}

function handleCropApplied(result: CropApplied) {
  const current = outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined;
  if (!current || current.url !== result.fromUrl) {
    // ACT: 裁剪期间输出可能被 AI 或上传改写；放弃本次结果并尽力删除新文件。
    void files.getWorkspaceFiles().remove(result.path).catch(() => {});
    ElMessage.warning("图片已变化，已取消本次裁剪");
    return;
  }
  const state = cropState();
  state.previous = { url: current.url, mimeType: current.mimeType };
  state.appliedUrl = result.path;
  outputs.value.image = { dataType: "IMAGE", value: { url: result.path, mimeType: result.mimeType } };
  const action = result.cropped ? (result.flipped ? "已裁剪并左右翻转" : "已裁剪") : "已左右翻转";
  ElMessage.success(`${action}为 ${result.width} × ${result.height}${result.formatChanged ? "，已转为 PNG" : ""}`);
}

function handleCropRestore() {
  const current = outputs.value.image?.dataType === "IMAGE" ? outputs.value.image.value : undefined;
  const state = cropState();
  const previous = state.previous;
  if (!current || !previous || current.url !== state.appliedUrl) return;
  outputs.value.image = { dataType: "IMAGE", value: { url: previous.url, mimeType: previous.mimeType } };
  delete state.previous;
  delete state.appliedUrl;
  ElMessage.success("已恢复裁剪前的图片");
}

function showError(error: unknown, fallback: string) {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  ElMessage.error(message || (error instanceof Error ? error.message : fallback));
}
</script>

<style scoped lang="scss">
.panoramaButton {
  &[aria-expanded="true"] .menuChevron { transform: rotate(180deg); }
}

.imageContent {
  min-height: 144px;

  .fileInput {
    display: none;
  }

  .uploadButton {
    width: 100%;
    height: 144px;
    padding: 0;
    color: var(--el-text-color-placeholder);

    &:hover {
      color: var(--el-color-primary);
    }
  }
}
</style>
