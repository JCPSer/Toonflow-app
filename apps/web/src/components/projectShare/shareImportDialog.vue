<template>
  <el-dialog
    v-model="visible"
    title="导入工程"
    width="min(560px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    :closeOnClickModal="false"
    :closeOnPressEscape="!busy"
    :showClose="!busy">
    <div class="shareDialog">
      <template v-if="mode === 'preparing'">
        <div class="progressHeader">
          <span>正在上传分享文件</span>
          <span v-if="upload?.total">{{ Math.round((upload.loaded / upload.total) * 100) }}%</span>
        </div>
        <el-progress :percentage="uploadPercent" :indeterminate="!upload?.total" />
        <p class="progressMeta">
          <span class="currentFile" :title="sourceName">{{ sourceName }}</span>
          <span v-if="upload?.total">{{ formatShareBytes(upload.loaded) }} / {{ formatShareBytes(upload.total) }}</span>
        </p>
      </template>

      <template v-else-if="mode === 'running'">
        <div class="progressHeader">
          <span>{{ phaseLabel }}</span>
          <span v-if="status?.total">{{ status.done }} / {{ status.total }}</span>
        </div>
        <el-progress :percentage="percent" :indeterminate="!status?.total" :status="cancelling ? 'warning' : undefined" />
        <p class="progressMeta">
          <span class="currentFile" :title="status?.currentFile">{{ status?.currentFile || "正在准备…" }}</span>
        </p>
        <p v-if="cancelling" class="fieldHint">正在取消，等待当前文件处理结束…</p>
      </template>

      <template v-else-if="mode === 'done'">
        <el-result icon="success" title="工程导入完成">
          <template #sub-title>
            <div class="resultBody">
              <p class="resultRow">
                <span>工程名称</span>
                <span>{{ importedName }}</span>
              </p>
              <p class="resultRow">
                <span>保存位置</span>
                <code>{{ importedPath }}</code>
              </p>
              <p v-if="importedStats" class="resultRow">
                <span>包内容</span>
                <span>{{ importedStats }}</span>
              </p>
              <p class="fieldHint">正在打开这个工程…</p>
            </div>
          </template>
        </el-result>
      </template>

      <template v-else-if="mode === 'password'">
        <el-alert class="passwordAlert" :title="errorMessage || '该分享包已加密，需要口令'" type="warning" :closable="false" showIcon />
        <el-form labelPosition="top" @submit.prevent="retry">
          <el-form-item label="分享口令">
            <el-input v-model="password" type="password" showPassword maxlength="200" autocomplete="off" placeholder="请输入分享者提供的口令" :disabled="cancelling" @keyup.enter="retry" />
          </el-form-item>
        </el-form>
      </template>

      <template v-else-if="mode === 'cancelled'">
        <el-result icon="warning" title="已取消导入" subTitle="没有写入任何工程文件。" />
      </template>

      <template v-else>
        <el-result icon="error" title="导入失败">
          <template #sub-title>
            <p class="errorMessage">{{ errorMessage }}</p>
          </template>
        </el-result>
      </template>
    </div>

    <template #footer>
      <template v-if="mode === 'preparing' || mode === 'running'">
        <el-button :loading="cancelling" @click="cancel">取消导入</el-button>
      </template>
      <template v-else-if="mode === 'done'">
        <el-button type="primary" @click="visible = false">完成</el-button>
      </template>
      <template v-else-if="mode === 'password'">
        <el-button :disabled="cancelling" @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="cancelling" :disabled="!password" @click="retry">用口令重试</el-button>
      </template>
      <template v-else-if="mode === 'cancelled'">
        <el-button @click="visible = false">关闭</el-button>
      </template>
      <template v-else>
        <el-button @click="visible = false">关闭</el-button>
        <el-button type="primary" @click="retry">重试导入</el-button>
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
  isSharePasswordMessage,
  pollShareTask,
  shareErrorMessage,
  startShareImport,
  uploadShareFile,
  SHARE_UPLOAD_LIMIT,
  type ShareImportResult,
  type ShareTaskStatus,
} from "@/lib/projectShare";

type ShareImportSource = { filePath: string } | { file: File };

const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ completed: [result: ShareImportResult] }>();

const mode = ref<"preparing" | "running" | "done" | "error" | "cancelled" | "password">("running");
const password = ref("");
const cancelling = ref(false);
const upload = ref<{ loaded: number; total: number }>();
const status = ref<ShareTaskStatus>();
const errorMessage = ref("");
const importedName = ref("");
const importedPath = ref("");
const importedStats = ref("");
let sourcePath = "";
let sourceFile: File | undefined;
let sourceName = "";
let taskId = "";
let controller: AbortController | undefined;
let disposed = false;

const busy = computed(() => mode.value === "preparing" || mode.value === "running");
const uploadPercent = computed(() => {
  const total = upload.value?.total ?? 0;
  return total > 0 ? Math.min(100, Math.round(((upload.value?.loaded ?? 0) / total) * 100)) : 0;
});
const percent = computed(() => {
  const total = status.value?.total ?? 0;
  return total > 0 ? Math.min(100, Math.round(((status.value?.done ?? 0) / total) * 100)) : 0;
});
const phaseLabel = computed(() => status.value?.phase === "importing" ? "正在写入工程文件" : "正在导入工程");

function stop() {
  controller?.abort();
  controller = undefined;
  const id = taskId;
  taskId = "";
  if (id && mode.value === "running") void cancelShareTask(id).catch(() => {});
}

watch(visible, value => { if (!value) stop(); });
onBeforeUnmount(() => {
  disposed = true;
  stop();
});

function start(source: ShareImportSource) {
  stop();
  sourcePath = "filePath" in source ? source.filePath : "";
  sourceFile = "file" in source ? source.file : undefined;
  sourceName = "file" in source ? source.file.name : source.filePath.split(/[\\/]/).pop() || source.filePath;
  password.value = "";
  upload.value = undefined;
  status.value = undefined;
  errorMessage.value = "";
  importedName.value = "";
  importedPath.value = "";
  importedStats.value = "";
  cancelling.value = false;
  mode.value = sourceFile ? "preparing" : "running";
  visible.value = true;
  void run();
}

defineExpose({ start });

async function run() {
  const current = new AbortController();
  controller = current;
  taskId = "";
  cancelling.value = false;
  errorMessage.value = "";
  try {
    let filePath = sourcePath;
    if (sourceFile) {
      if (!sourceFile.size) throw new Error("分享文件为空，无法导入");
      if (sourceFile.size > SHARE_UPLOAD_LIMIT) throw new Error("分享文件超过 2 GiB 上限，无法导入");
      mode.value = "preparing";
      upload.value = { loaded: 0, total: sourceFile.size };
      filePath = await uploadShareFile(sourceFile, (loaded, total) => {
        if (controller === current) upload.value = { loaded, total };
      }, current.signal);
      sourcePath = filePath;
      // ACT: 上传只做一次；口令重试、失败重试都复用服务端临时路径。
      sourceFile = undefined;
    }
    current.signal.throwIfAborted();
    if (disposed) return;
    mode.value = "running";
    status.value = undefined;
    const task = await startShareImport({ filePath, password: password.value || undefined });
    if (disposed) {
      void cancelShareTask(task.id).catch(() => {});
      return;
    }
    taskId = task.id;
    const final = await pollShareTask(task.id, undefined, {
      signal: current.signal,
      onUpdate: state => { if (controller === current) status.value = state; },
    });
    if (current.signal.aborted) return;
    status.value = final;
    if (final.cancelled) {
      mode.value = "cancelled";
    } else if (final.error) {
      errorMessage.value = final.error;
      mode.value = isSharePasswordMessage(final.error) ? "password" : "error";
    } else if (final.result?.path) {
      importedPath.value = final.result.path;
      importedName.value = final.result.manifest?.project?.name || importedPath.value.split(/[\\/]/).pop() || "未命名工程";
      const stats = final.result.manifest?.stats;
      importedStats.value = stats ? `${stats.fileCount} 个文件，${formatShareBytes(stats.bytes)}` : "";
      mode.value = "done";
      emit("completed", { path: final.result.path, name: importedName.value, manifest: final.result.manifest });
    } else {
      errorMessage.value = "导入完成，但没有拿到工程目录";
      mode.value = "error";
    }
  } catch (error) {
    if (isAbortError(error) || current.signal.aborted) return;
    errorMessage.value = shareErrorMessage(error, "导入失败，请重试");
    mode.value = "error";
  } finally {
    if (controller === current) controller = undefined;
    if (!busy.value) cancelling.value = false;
  }
}

function retry() {
  if (busy.value) return;
  void run();
}

async function cancel() {
  if (cancelling.value) return;
  cancelling.value = true;
  if (mode.value === "preparing") {
    // 上传阶段没有服务端任务，直接中止 XHR。
    stop();
    cancelling.value = false;
    mode.value = "cancelled";
    return;
  }
  if (!taskId) {
    cancelling.value = false;
    return;
  }
  try {
    await cancelShareTask(taskId);
  } catch (error) {
    cancelling.value = false;
    ElMessage.warning(shareErrorMessage(error, "取消请求失败，正在等待任务自行结束"));
  }
}
</script>

<style scoped lang="scss">
.shareDialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 96px;

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

  .passwordAlert { margin-bottom: 4px; }

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

      > code {
        min-width: 0;
        overflow-wrap: anywhere;
        color: var(--el-text-color-primary);
        font-size: 12px;
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
