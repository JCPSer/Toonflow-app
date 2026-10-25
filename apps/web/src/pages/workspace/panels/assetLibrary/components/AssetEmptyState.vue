<template>
  <div class="assetEmptyState">
    <template v-if="kind === 'error'">
      <icon-alert-triangle :size="42" stroke="1.25" aria-hidden="true" />
      <strong>{{ translate("素材库加载失败") }}</strong>
      <span>{{ message || translate("请稍后重试；若持续失败，请检查素材库目录是否存在、磁盘是否可用。") }}</span>
      <div class="emptyActions">
        <el-button size="small" @click="emit('refresh')">{{ translate("重试") }}</el-button>
        <el-button v-if="canSwitchGlobal" size="small" type="primary" @click="emit('switch-global')">{{ translate("切换到全局库") }}</el-button>
      </div>
    </template>
    <template v-else-if="kind === 'search'">
      <icon-search :size="42" stroke="1.25" aria-hidden="true" />
      <strong>{{ translate("没有找到匹配的素材") }}</strong>
      <span>{{ translate("试试更换关键词，或清空搜索继续浏览当前文件夹。") }}</span>
      <div class="emptyActions">
        <el-button size="small" @click="emit('clear-search')">{{ translate("清除搜索") }}</el-button>
      </div>
    </template>
    <template v-else-if="kind === 'rebuilding'">
      <icon-loader-2 class="spin" :size="40" aria-hidden="true" />
      <strong>{{ translate("正在重建素材索引") }}</strong>
      <span>{{ translate("首次打开或外部改动较大时会扫描目录；稍后刷新即可看到全部素材。") }}</span>
      <div class="emptyActions">
        <el-button size="small" :loading="loading" @click="emit('refresh')">{{ translate("刷新") }}</el-button>
      </div>
    </template>
    <template v-else-if="kind === 'project-unavailable'">
      <icon-folder-off :size="42" stroke="1.25" aria-hidden="true" />
      <strong>{{ translate("项目素材库暂不可用") }}</strong>
      <span>{{ translate("无法创建或访问项目的 library 目录。可以先使用全局素材库，或重试。") }}</span>
      <div class="emptyActions">
        <el-button size="small" @click="emit('refresh')">{{ translate("重试") }}</el-button>
        <el-button size="small" type="primary" @click="emit('switch-global')">{{ translate("切换到全局库") }}</el-button>
      </div>
    </template>
    <template v-else>
      <icon-folder :size="44" stroke="1.25" aria-hidden="true" />
      <strong>{{ translate("这个文件夹是空的") }}</strong>
      <span>{{ translate("上传素材，或先新建一个子文件夹来整理内容。") }}</span>
      <div class="emptyActions">
        <el-button size="small" :icon="IconUpload" @click="emit('upload')">{{ translate("上传") }}</el-button>
        <el-button size="small" :icon="IconFolderPlus" @click="emit('create-folder')">{{ translate("新建文件夹") }}</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { translate } from "@toonflow/i18n/vue";
import { IconAlertTriangle, IconFolder, IconFolderOff, IconFolderPlus, IconLoader2, IconSearch, IconUpload } from "@tabler/icons-vue";

withDefaults(defineProps<{
  kind?: "loading" | "directory" | "search" | "rebuilding" | "project-unavailable" | "error";
  loading?: boolean;
  message?: string;
  canSwitchGlobal?: boolean;
}>(), { kind: "directory", loading: false, message: "", canSwitchGlobal: false });
const emit = defineEmits<{
  upload: [];
  "create-folder": [];
  refresh: [];
  "clear-search": [];
  "switch-global": [];
}>();
</script>

<style scoped lang="scss">
.assetEmptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  padding: 30px 16px;
  color: var(--el-text-color-secondary);
  text-align: center;

  strong { color: var(--el-text-color-primary); font-size: 14px; }
  span { max-width: 320px; font-size: 12px; line-height: 1.6; }
  .spin { animation: assetSpin 1s linear infinite; }

  .emptyActions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
}

@keyframes assetSpin { to { transform: rotate(360deg); } }
</style>
