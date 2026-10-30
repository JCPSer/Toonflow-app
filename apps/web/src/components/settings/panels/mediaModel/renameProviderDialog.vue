<template>
  <el-dialog
    v-model="visible"
    title="重命名媒体供应商"
    width="min(480px, calc(100vw - 32px))"
    alignCenter
    appendToBody
    destroyOnClose
    :closeOnClickModal="false"
    :closeOnPressEscape="!saving"
    :showClose="!saving"
    @opened="focusInput">
    <div class="dialogContent">
      <el-form labelPosition="top" @submit.prevent="submit">
        <el-form-item label="显示名称" required>
          <el-input ref="inputRef" v-model="draft" maxlength="200" clearable :disabled="saving" aria-label="供应商显示名称" />
        </el-form-item>
      </el-form>
      <el-text type="info" size="small">只修改显示名称；供应商 ID（文件名）、模型与连接配置不变。</el-text>
    </div>
    <el-alert v-if="formError" class="formError" :title="formError" type="error" :closable="false" showIcon />
    <template #footer>
      <el-button :disabled="saving" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import axios from "axios";
import { ElMessage, type InputInstance } from "element-plus";
import { ref, watch } from "vue";
import type { MediaProvider } from "./types";

const { provider, existingLabels = [] } = defineProps<{ provider?: MediaProvider; existingLabels?: string[] }>();
const visible = defineModel<boolean>({ default: false });
const emit = defineEmits<{ saved: [provider: MediaProvider]; conflict: [] }>();
const inputRef = ref<InputInstance>();
const draft = ref("");
const saving = ref(false);
const formError = ref("");

watch(visible, value => {
  if (!value) return;
  draft.value = provider?.label ?? "";
  formError.value = "";
}, { immediate: true });

watch(draft, () => { formError.value = ""; });

function focusInput() {
  inputRef.value?.focus();
  inputRef.value?.select();
}

function validate(name: string) {
  if (!name) return "请输入显示名称";
  if (name.length > 200) return "显示名称不能超过 200 个字符";
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(name) || /\p{Cf}/u.test(name.replaceAll("\u200d", ""))) return "显示名称不能包含换行、控制字符或不可见字符";
  if (existingLabels.some(label => label.trim() === name)) return `已存在同名供应商：${name}`;
  return "";
}

async function submit() {
  if (saving.value || !provider) return;
  const name = draft.value.trim();
  // ACT: 名字没变直接关闭，不写盘也不换 revision（服务端同样短路）；放在重名校验之前，历史上已存在的同名供应商不会卡住「保持原名」。
  if (name === provider.label.trim()) {
    visible.value = false;
    return;
  }
  formError.value = validate(name);
  if (formError.value) return;
  saving.value = true;
  try {
    const { data } = await axios.put<{ code: number; data: MediaProvider; message?: string }>("/api/providers/media/rename", {
      fileName: provider.fileName, label: name, revision: provider.revision,
    });
    if (data.code !== 200 || !data.data) throw new Error(data.message || "重命名失败");
    emit("saved", data.data);
    ElMessage.success("已重命名");
    visible.value = false;
  } catch (error) {
    const message = axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "重命名失败，请重试";
    // ACT: 409「已被修改」说明本地 revision 过期（文案与后端约定，重名 409 不含该词）；弹窗内的 revision 已不可用，交给父组件刷新列表后重新打开。
    if (axios.isAxiosError(error) && error.response?.status === 409 && message.includes("已被修改")) {
      visible.value = false;
      emit("conflict");
      return;
    }
    formError.value = message;
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.dialogContent { display: flex; flex-direction: column; gap: 8px; }

.formError { margin-top: 16px; }
</style>
