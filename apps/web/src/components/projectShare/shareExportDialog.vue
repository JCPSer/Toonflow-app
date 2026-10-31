<template>
  <el-dialog
    v-model="visible"
    title="分享工程"
    width="min(560px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    :closeOnClickModal="false"
    :closeOnPressEscape="!running"
    :showClose="!running">
    <div class="shareDialog">
      <template v-if="mode === 'form'">
        <p class="shareIntro">把当前工程打包成一个 .tfproj 文件，对方导入后即可继续编辑。图片和视频会自动压缩，引用缺失的文件不会中断导出。</p>
        <el-form labelPosition="top" @submit.prevent>
          <el-form-item label="分享口令">
            <el-input v-model="password" type="password" showPassword maxlength="200" autocomplete="new-password" placeholder="可留空" :disabled="starting" />
            <p class="fieldHint">留空则不加密，任何人都能打开。设置口令后，导入时需要输入相同口令。</p>
          </el-form-item>
        </el-form>
      </template>

      <template v-else-if="mode === 'running'">
        <div class="progressHeader">
          <span>{{ phaseLabel }}</span>
          <span v-if="status?.total">{{ status.done }} / {{ status.total }}</span>
        </div>
        <el-progress
          :percentage="percent"
          :indeterminate="!status?.total"
          :status="cancelling ? 'warning' : undefined" />
        <p class="progressMeta">
          <span class="currentFile" :title="status?.currentFile">{{ status?.currentFile || "正在准备…" }}</span>
          <span v-if="status?.bytes">{{ formatShareBytes(status.bytes) }}</span>
        </p>
        <p v-if="cancelling" class="fieldHint">正在取消，等待当前文件处理结束…</p>
      </template>

      <template v-else-if="mode === 'done'">
        <el-result icon="success" title="分享文件已导出">
          <template #sub-title>
            <div class="resultBody">
              <p class="resultRow">
                <span>保存位置</span>
                <code>{{ status?.result?.path }}</code>
              </p>
              <p class="resultRow">
                <span>加密</span>
                <el-tag :type="encrypted ? 'success' : 'info'" size="small">{{ encrypted ? "已加密" : "未加密" }}</el-tag>
              </p>
              <p v-if="manifestStats" class="resultRow">
                <span>包内容</span>
                <span>{{ manifestStats }}</span>
              </p>
              <template v-if="status?.missing?.length">
                <p class="resultRow resultRowTop">
                  <span>引用缺失</span>
                  <span>{{ status.missing.length }} 个文件</span>
                </p>
                <ul class="shareFileList" aria-label="引用缺失的文件">
                  <li v-for="path in status.missing" :key="path" :title="path">{{ path }}</li>
                </ul>
              </template>
              <template v-if="status?.skippedLarger?.length">
                <p class="resultRow resultRowTop">
                  <span>压缩后更大</span>
                  <span>{{ status.skippedLarger.length }} 个文件（已保留原样）</span>
                </p>
                <ul class="shareFileList" aria-label="压缩后更大、保留原样的文件">
                  <li v-for="path in status.skippedLarger" :key="path" :title="path">{{ path }}</li>
                </ul>
              </template>
            </div>
          </template>
        </el-result>
      </template>

      <template v-else-if="mode === 'cancelled'">
        <el-result icon="warning" title="已取消导出" subTitle="分享文件没有生成，工程本身不受影响。" />
      </template>

      <template v-else>
        <el-result :icon="ffmpegRequired ? 'warning' : 'error'" :title="ffmpegRequired ? '需要 FFmpeg' : '导出失败'">
          <template #sub-title>
            <p class="errorMessage">{{ errorMessage }}</p>
            <p v-if="ffmpegRequired" class="fieldHint">请先在设置 → 插件市场 → FFmpeg 中安装。</p>
          </template>
        </el-result>
      </template>
    </div>

    <template #footer>
      <template v-if="mode === 'form'">
        <el-button :disabled="starting" @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="starting" @click="start">开始导出</el-button>
      </template>
      <template v-else-if="mode === 'running'">
        <el-button :loading="cancelling" @click="cancel">取消导出</el-button>
      </template>
      <template v-else-if="mode === 'done'">
        <el-button type="primary" @click="visible = false">完成</el-button>
      </template>
      <template v-else-if="mode === 'cancelled'">
        <el-button @click="visible = false">关闭</el-button>
        <el-button type="primary" @click="reset">重新导出</el-button>
      </template>
      <template v-else>
        <el-button @click="visible = false">关闭</el-button>
        <el-button v-if="ffmpegRequired" type="primary" @click="openFfmpegSettings">前往安装</el-button>
        <el-button v-else type="primary" @click="reset">重新导出</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  cancelShareTask,
  formatShareBytes,
  isAbortError,
  isFfmpegRequired,
  isFfmpegRequiredMessage,
  pollShareTask,
  selectShareSaveTarget,
  shareErrorMessage,
  shareFileName,
  shareProjectName,
  startShareExport,
  type ShareTaskStatus,
} from "@/lib/projectShare";

const visible = defineModel<boolean>({ default: false });
const props = defineProps<{ directory: string; projectName: string }>();
const emit = defineEmits<{ "open-ffmpeg-settings": [] }>();

const mode = ref<"form" | "running" | "done" | "error" | "cancelled">("form");
const password = ref("");
const starting = ref(false);
const cancelling = ref(false);
const status = ref<ShareTaskStatus>();
const errorMessage = ref("");
const ffmpegRequired = ref(false);
const encrypted = ref(false);
let taskId = "";
let controller: AbortController | undefined;
let disposed = false;

const running = computed(() => mode.value === "running");
const phaseLabel = computed(() => {
  const labels: Record<string, string> = { collecting: "收集工程文件", compressing: "压缩媒体", packing: "写入分享包" };
  return labels[status.value?.phase ?? ""] ?? "正在处理";
});
const percent = computed(() => {
  const total = status.value?.total ?? 0;
  return total > 0 ? Math.min(100, Math.round(((status.value?.done ?? 0) / total) * 100)) : 0;
});
const manifestStats = computed(() => {
  const stats = status.value?.result?.manifest?.stats;
  if (!stats) return "";
  // ACT: stats.compressed 是「做了 deflate 的条目数」，不是字节数，别当体积展示。
  return `${stats.fileCount} 个文件，原始合计 ${formatShareBytes(stats.bytes)}${stats.compressed ? `，其中 ${stats.compressed} 个文本条目已压缩` : ""}`;
});

/** 终止轮询；仍在跑的任务顺手取消，避免关窗后服务端继续压缩。 */
function stop() {
  controller?.abort();
  controller = undefined;
  const id = taskId;
  taskId = "";
  if (id && mode.value === "running") void cancelShareTask(id, props.directory).catch(() => {});
}

function reset() {
  stop();
  mode.value = "form";
  password.value = "";
  starting.value = false;
  cancelling.value = false;
  status.value = undefined;
  errorMessage.value = "";
  ffmpegRequired.value = false;
  encrypted.value = false;
}

watch(visible, value => {
  if (value) reset();
  else stop();
});
onBeforeUnmount(() => {
  disposed = true;
  stop();
});

function startTask(id: string) {
  taskId = id;
  const current = new AbortController();
  controller = current;
  mode.value = "running";
  cancelling.value = false;
  status.value = undefined;
  void (async () => {
    try {
      const final = await pollShareTask(id, props.directory, {
        signal: current.signal,
        onUpdate: state => { if (controller === current) status.value = state; },
      });
      if (current.signal.aborted) return;
      status.value = final;
      if (final.cancelled) mode.value = "cancelled";
      else if (final.error) {
        errorMessage.value = final.error;
        ffmpegRequired.value = isFfmpegRequiredMessage(final.error);
        mode.value = "error";
      } else mode.value = "done";
    } catch (error) {
      if (isAbortError(error) || current.signal.aborted) return;
      errorMessage.value = shareErrorMessage(error, "读取导出进度失败，请重试");
      mode.value = "error";
    } finally {
      if (controller === current) controller = undefined;
    }
  })();
}

async function start() {
  if (starting.value || running.value) return;
  starting.value = true;
  errorMessage.value = "";
  ffmpegRequired.value = false;
  try {
    // ACT: 先选保存位置，用户取消文件对话框就停在这一步，不创建服务端任务。
    const saveToken = await selectShareSaveTarget(shareFileName(props.projectName));
    if (!saveToken || disposed) return;
    encrypted.value = password.value.length > 0;
    const task = await startShareExport({
      directory: props.directory,
      name: shareProjectName(props.projectName),
      saveToken,
      password: password.value || undefined,
    });
    if (disposed) {
      void cancelShareTask(task.id, props.directory).catch(() => {});
      return;
    }
    startTask(task.id);
  } catch (error) {
    errorMessage.value = shareErrorMessage(error, "无法开始导出，请重试");
    ffmpegRequired.value = isFfmpegRequired(error);
    mode.value = "error";
  } finally {
    starting.value = false;
  }
}

async function cancel() {
  if (!taskId || cancelling.value) return;
  cancelling.value = true;
  try {
    await cancelShareTask(taskId, props.directory);
  } catch (error) {
    // 轮询仍在继续；任务若刚好完成，会由 status 收尾。
    cancelling.value = false;
    ElMessage.warning(shareErrorMessage(error, "取消请求失败，正在等待任务自行结束"));
  }
}

function openFfmpegSettings() {
  emit("open-ffmpeg-settings");
  visible.value = false;
}
</script>

<style scoped lang="scss">
.shareDialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 96px;

  .shareIntro {
    margin: 0;
    color: var(--el-text-color-regular);
    font-size: 13px;
    line-height: 1.7;
  }

  .fieldHint {
    margin: 6px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
  }

  .progressHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    color: var(--el-text-color-regular);
    font-size: 13px;
  }

  .progressMeta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 10px 0 0;
    color: var(--el-text-color-secondary);
    font-size: 12px;

    .currentFile {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .resultBody {
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: start;

    .resultRow {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      font-size: 13px;
      line-height: 1.7;

      > span:first-child {
        flex: 0 0 68px;
        color: var(--el-text-color-secondary);
      }

      code {
        min-width: 0;
        overflow-wrap: anywhere;
        color: var(--el-text-color-primary);
        font-size: 12px;
      }
    }

    .resultRowTop { align-items: flex-start; }

    .shareFileList {
      max-height: 108px;
      margin: 0;
      padding: 8px 10px;
      overflow-y: auto;
      border-radius: var(--ui-radius);
      background: var(--el-fill-color-light);
      list-style: none;

      li {
        overflow: hidden;
        color: var(--el-text-color-regular);
        font-size: 12px;
        line-height: 1.7;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  .errorMessage {
    margin: 0;
    color: var(--el-text-color-regular);
    font-size: 13px;
    line-height: 1.7;
    overflow-wrap: anywhere;
  }
}
</style>
