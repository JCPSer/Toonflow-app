<template>
  <el-dialog
    v-model="visible"
    title="Agent 角色"
    width="min(720px, calc(100vw - 32px))"
    append-to-body
    class="agentRolesDialog"
    :close-on-click-modal="false">
    <p class="rolesHint">角色给 Agent 一个固定的身份与职责。选中后它的系统提示词排在软件默认提示之前：职责、语气与工作范围以角色为准；工具授权与算力确认仍按软件规则执行。描述只用于列表展示，不进入提示词。</p>
    <div class="rolesBody">
      <aside class="rolesList">
        <el-button size="small" type="primary" plain :icon="IconPlus" :disabled="draft.length >= 50" @click="addRole">新增角色（{{ draft.length }}/50）</el-button>
        <div class="rolesItems" role="listbox" aria-label="角色列表">
          <button
            v-for="role in draft"
            :key="role.id"
            type="button"
            class="rolesItem"
            :class="{ active: role.id === selectedId }"
            role="option"
            :aria-selected="role.id === selectedId"
            @click="selectedId = role.id">
            <span class="rolesItemName">{{ role.name || "未命名角色" }}</span>
            <span v-if="referenced.includes(role.id)" class="rolesItemBadge">使用中</span>
          </button>
          <p v-if="!draft.length" class="rolesEmpty">还没有角色</p>
        </div>
      </aside>
      <section v-if="current" class="rolesForm">
        <el-form labelPosition="top">
          <el-form-item label="名称">
            <el-input v-model="current.name" maxlength="40" show-word-limit placeholder="如：提示词审核员" />
          </el-form-item>
          <el-form-item label="描述（可选）">
            <el-input v-model="current.description" maxlength="200" show-word-limit placeholder="一句话说明它负责什么" />
          </el-form-item>
          <el-form-item label="系统提示词">
            <el-input
              v-model="current.prompt"
              type="textarea"
              :rows="14"
              maxlength="20000"
              show-word-limit
              placeholder="写下这个角色的职责、判断标准、输出要求。选中后作为该 Agent 的初始身份。不支持 tools 之类的花括号占位符。" />
          </el-form-item>
        </el-form>
        <div class="rolesFormActions">
          <el-button text type="danger" :icon="IconTrash" @click="removeRole(current.id)">删除角色</el-button>
        </div>
      </section>
      <section v-else class="rolesPlaceholder">
        <span>左侧选择或新建一个角色</span>
      </section>
    </div>
    <template #footer>
      <span class="rolesBudget" :class="{ over: totalChars > ROLE_PROMPT_BUDGET }">角色提示词合计 {{ totalChars }} / {{ ROLE_PROMPT_BUDGET }} 字</span>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { IconPlus, IconTrash } from "@tabler/icons-vue";
import { agentRoles, saveSettings, type AgentRoleOption } from "@/stores/settings";

const visible = defineModel<boolean>({ default: false });
const props = withDefaults(defineProps<{ referenced?: string[] }>(), { referenced: () => [] });
const emit = defineEmits<{ saved: [] }>();

// ACT: 系统提示不参与压缩，角色总量必须留出预算，否则小窗口模型会直接不可用。
const ROLE_PROMPT_BUDGET = 50000;
const draft = ref<AgentRoleOption[]>([]);
const selectedId = ref("");
const saving = ref(false);
const referenced = computed(() => props.referenced);

const current = computed(() => draft.value.find(role => role.id === selectedId.value));
const totalChars = computed(() => draft.value.reduce((sum, role) => sum + role.prompt.trim().length, 0));

// ACT: 每次打开都从设置重新克隆，避免上次未保存的编辑串到下一次。
watch(visible, open => {
  if (!open) return;
  draft.value = agentRoles.value.map(role => ({ ...role }));
  selectedId.value = draft.value[0]?.id ?? "";
});

function addRole() {
  const role: AgentRoleOption = { id: crypto.randomUUID(), name: "", prompt: "" };
  draft.value.push(role);
  selectedId.value = role.id;
}

async function removeRole(id: string) {
  const role = draft.value.find(item => item.id === id);
  if (!role) return;
  try {
    await ElMessageBox.confirm(
      referenced.value.includes(id)
        ? `「${role.name || "未命名角色"}」正被画布上的节点使用，删除后这些节点会回退到通用。`
        : `删除角色「${role.name || "未命名角色"}」？`,
      "删除角色",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch { return; }
  draft.value = draft.value.filter(item => item.id !== id);
  if (selectedId.value === id) selectedId.value = draft.value[0]?.id ?? "";
}

async function save() {
  const invalid = draft.value.find(role => !role.name.trim() || !role.prompt.trim());
  if (invalid) return ElMessage.warning("角色的名称和系统提示词都不能为空");
  if (totalChars.value > ROLE_PROMPT_BUDGET) return ElMessage.warning(`角色提示词合计不能超过 ${ROLE_PROMPT_BUDGET} 字，请精简后再保存`);
  saving.value = true;
  try {
    const roles = draft.value.map(role => ({
      id: role.id, name: role.name.trim(), prompt: role.prompt,
      ...(role.description?.trim() ? { description: role.description.trim() } : {}),
      updatedAt: new Date().toISOString(),
    }));
    await saveSettings(current => ({ ...current, agentRoles: roles }));
    ElMessage.success("角色已保存");
    visible.value = false;
    emit("saved");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "角色保存失败");
  } finally {
    saving.value = false;
  }
}
</script>

<style lang="scss">
.agentRolesDialog {
  .el-dialog__footer {
    display: flex;
    align-items: center;
  }

  .rolesBudget {
    margin-right: auto;
    color: var(--el-text-color-secondary);
    font-size: 12px;

    &.over { color: var(--el-color-danger); }
  }

  .rolesHint {
    margin: 0 0 12px;
    color: var(--el-text-color-secondary);
    font-size: 12px;
    line-height: 1.6;
  }

  .rolesBody {
    display: flex;
    gap: 16px;
    min-height: 360px;
  }

  .rolesList {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 200px;
    flex-shrink: 0;

    .rolesItems {
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow-y: auto;
      max-height: 420px;
    }

    .rolesItem {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 8px 10px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: var(--el-text-color-regular);
      font-size: 13px;
      text-align: left;
      cursor: pointer;

      &:hover { background: var(--el-fill-color-light); }
      &.active {
        border-color: var(--el-color-primary-light-5);
        background: var(--el-color-primary-light-9);
        color: var(--el-text-color-primary);
      }
    }

    .rolesItemName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rolesItemBadge {
      flex-shrink: 0;
      padding: 0 6px;
      border-radius: 8px;
      background: var(--el-color-success-light-8);
      color: var(--el-color-success);
      font-size: 11px;
      line-height: 18px;
    }

    .rolesEmpty {
      margin: 8px 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }
  }

  .rolesForm {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;

    .rolesFormActions {
      display: flex;
      justify-content: flex-start;
      margin-top: 4px;
    }
  }

  .rolesPlaceholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
}
</style>
