<template>
  <div ref="toolbarElement" class="assetToolbar" :class="{ narrow }" role="toolbar" :aria-label="translate('素材库工具栏')">
    <div class="toolbarRow">
      <el-button
        class="toolButton"
        text
        size="small"
        :icon="IconFolderPlus"
        :disabled="loading || !canWrite"
        :aria-label="translate('新建文件夹')"
        :title="translate('新建文件夹')"
        @click="emit('create-folder')" />

      <el-button
        class="toolButton"
        text
        size="small"
        :icon="IconUpload"
        :disabled="loading || !canWrite"
        :aria-label="translate('上传素材')"
        :title="translate('上传素材')"
        @click="emit('upload')" />

      <template v-if="!narrow">
        <el-dropdown trigger="click" :disabled="loading" popper-class="assetToolbarMenu" @command="handleSortCommand">
          <el-button class="sortButton" text size="small" :aria-label="translate('排序')">
            {{ sortLabel }}
            <component :is="order === 'asc' ? IconSortAscending : IconSortDescending" :size="14" aria-hidden="true" />
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="field in sortFields" :key="field.value" :command="`sort:${field.value}`" :class="{ 'is-active': sort === field.value }">
                <component :is="sort === field.value ? IconCheck : IconMinus" :size="14" aria-hidden="true" />
                {{ field.label }}
              </el-dropdown-item>
              <el-dropdown-item divided :command="`order:${order === 'asc' ? 'desc' : 'asc'}`">
                <component :is="order === 'asc' ? IconSortDescending : IconSortAscending" :size="14" aria-hidden="true" />
                {{ order === "asc" ? translate("改为降序") : translate("改为升序") }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-divider direction="vertical" />
      </template>

      <el-button
        class="toolButton"
        text
        size="small"
        :type="view === 'tree' ? 'primary' : undefined"
        :aria-pressed="view === 'tree'"
        :aria-label="translate('树形视图')"
        :title="translate('树形视图')"
        @click="view = 'tree'">
        <icon-list-tree :size="16" aria-hidden="true" />
      </el-button>
      <el-button
        class="toolButton"
        text
        size="small"
        :type="view === 'folder' ? 'primary' : undefined"
        :aria-pressed="view === 'folder'"
        :aria-label="translate('文件夹视图')"
        :title="translate('文件夹视图')"
        @click="view = 'folder'">
        <icon-layout-grid :size="16" aria-hidden="true" />
      </el-button>

      <el-button
        class="toolButton"
        text
        size="small"
        :icon="IconSearch"
        :aria-pressed="searchOpen"
        :aria-label="translate('搜索素材')"
        :title="translate('搜索素材')"
        @click="toggleSearch" />

      <el-button
        v-if="!narrow"
        class="toolButton"
        text
        size="small"
        :icon="IconRefresh"
        :loading="loading"
        :aria-label="translate('刷新')"
        :title="translate('刷新')"
        @click="emit('refresh')" />

      <span class="toolbarSpacer" />
      <span v-if="mock" class="mockBadge" :title="translate('后端素材接口未就绪，当前显示本地演示数据')">
        {{ translate("演示数据") }}
      </span>

      <el-dropdown trigger="click" popper-class="assetToolbarMenu" @command="handleMoreCommand">
        <el-button class="toolButton" text size="small" :icon="IconDots" :aria-label="translate('更多操作')" :title="translate('更多操作')" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-if="mock" disabled>
              {{ translate("素材接口未就绪，当前为演示数据") }}
            </el-dropdown-item>
            <template v-if="narrow">
              <el-dropdown-item disabled class="menuHeading">{{ translate("排序") }}</el-dropdown-item>
              <el-dropdown-item v-for="field in sortFields" :key="`narrow-${field.value}`" :command="`sort:${field.value}`">
                <component :is="sort === field.value ? IconCheck : IconMinus" :size="14" aria-hidden="true" />
                {{ field.label }}
              </el-dropdown-item>
              <el-dropdown-item :command="`order:${order === 'asc' ? 'desc' : 'asc'}`">
                {{ order === "asc" ? translate("改为降序") : translate("改为升序") }}
              </el-dropdown-item>
              <el-dropdown-item :command="'refresh'" :disabled="loading">
                <icon-refresh :size="14" aria-hidden="true" />{{ translate("刷新") }}
              </el-dropdown-item>
            </template>
            <el-dropdown-item v-if="library !== 'global'" command="library:global">
              {{ translate("切换到全局库") }}
            </el-dropdown-item>
            <el-dropdown-item v-else-if="projectAvailable" command="library:project">
              {{ translate("切换到项目库") }}
            </el-dropdown-item>
            <el-dropdown-item divided command="trash">
              <icon-trash :size="14" aria-hidden="true" />{{ translate("回收站") }}
            </el-dropdown-item>
            <el-dropdown-item command="empty-trash" class="dangerItem">
              <icon-trash-x :size="14" aria-hidden="true" />{{ translate("清空回收站") }}
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div v-if="searchOpen" class="searchRow">
      <el-input
        ref="searchInput"
        v-model="query"
        class="searchInput"
        size="small"
        :prefixIcon="IconSearch"
        :placeholder="searchPlaceholder"
        :aria-label="translate('搜索素材')"
        clearable
        @keydown.enter.prevent="emit('submit-search')"
        @keydown.esc.stop="closeSearch" />
    </div>

    <div v-if="selectionCount" class="selectionRow" role="status" aria-live="polite">
      <span class="selectionText">{{ translate("已选 {count} 项", { count: selectionCount }) }}</span>
      <el-button text size="small" :disabled="loading || !canWrite" @click="emit('move-selection')">{{ translate("移动到…") }}</el-button>
      <el-button text size="small" type="danger" :disabled="loading || !canWrite" @click="emit('delete-selection')">{{ translate("删除") }}</el-button>
      <el-button text size="small" @click="emit('clear-selection')">{{ translate("取消") }}</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { translate } from "@toonflow/i18n/vue";
import type { InputInstance } from "element-plus";
import {
  IconCheck, IconDots, IconFolderPlus, IconLayoutGrid, IconListTree, IconMinus, IconRefresh, IconSearch,
  IconSortAscending, IconSortDescending, IconTrash, IconTrashX, IconUpload,
} from "@tabler/icons-vue";
import type { AssetLibraryKind, AssetSortField, AssetSortOrder, AssetView } from "../types";

const view = defineModel<AssetView>("view", { required: true });
const sort = defineModel<AssetSortField>("sort", { required: true });
const order = defineModel<AssetSortOrder>("order", { required: true });
const query = defineModel<string>("query", { default: "" });
const props = withDefaults(defineProps<{
  loading?: boolean;
  selectionCount?: number;
  mock?: boolean;
  canWrite?: boolean;
  searchPlaceholder?: string;
  /** 当前库与项目库可用性只用于「更多操作」里的切库项，不再提供显眼下拉。 */
  library?: AssetLibraryKind;
  projectAvailable?: boolean;
}>(), {
  loading: false, selectionCount: 0, mock: false, canWrite: true, searchPlaceholder: "搜索素材",
  library: "global", projectAvailable: false,
});
const emit = defineEmits<{
  "create-folder": [];
  upload: [];
  refresh: [];
  "submit-search": [];
  "clear-search": [];
  "open-trash": [];
  "empty-trash": [];
  "move-selection": [];
  "delete-selection": [];
  "clear-selection": [];
  "switch-library": [library: AssetLibraryKind];
}>();

const toolbarElement = ref<HTMLElement>();
const searchInput = ref<InputInstance>();
const searchOpen = ref(false);
const width = ref(0);
const narrow = computed(() => width.value > 0 && width.value < 620);
const sortFields = computed<{ label: string; value: AssetSortField }[]>(() => [
  { label: translate("名称"), value: "name" },
  { label: translate("修改时间"), value: "mtime" },
  { label: translate("大小"), value: "size" },
  { label: translate("类型"), value: "type" },
]);
const sortLabel = computed(() => sortFields.value.find(field => field.value === sort.value)?.label ?? translate("名称"));

let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!toolbarElement.value) return;
  width.value = toolbarElement.value.clientWidth;
  observer = new ResizeObserver(entries => {
    width.value = entries[0]?.contentRect.width ?? toolbarElement.value?.clientWidth ?? 0;
  });
  observer.observe(toolbarElement.value);
});
onBeforeUnmount(() => observer?.disconnect());

function handleSortCommand(command: string) {
  if (command.startsWith("sort:")) sort.value = command.slice(5) as AssetSortField;
  else if (command.startsWith("order:")) order.value = command.slice(6) as AssetSortOrder;
}

function handleMoreCommand(command: string) {
  if (command.startsWith("sort:")) sort.value = command.slice(5) as AssetSortField;
  else if (command.startsWith("order:")) order.value = command.slice(6) as AssetSortOrder;
  else if (command.startsWith("view:")) view.value = command.slice(5) as AssetView;
  else if (command.startsWith("library:")) emit("switch-library", command.slice(8) as AssetLibraryKind);
  else if (command === "search") void toggleSearch();
  else if (command === "refresh") emit("refresh");
  else if (command === "trash") emit("open-trash");
  else if (command === "empty-trash") emit("empty-trash");
}

async function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (!searchOpen.value) {
    if (query.value) {
      query.value = "";
      emit("clear-search");
    }
    return;
  }
  await nextTick();
  searchInput.value?.focus();
}

function closeSearch() {
  if (query.value) {
    query.value = "";
    emit("clear-search");
  }
  searchOpen.value = false;
}
</script>

<style scoped lang="scss">
.assetToolbar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  .toolbarRow {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;

    .toolButton {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
    }

    .sortButton {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 0;
      padding: 4px 6px;
      font-weight: normal;
    }

    .toolbarSpacer { flex: 1; min-width: 4px; }

    .mockBadge {
      flex-shrink: 0;
      max-width: 58px;
      overflow: hidden;
      padding: 1px 6px;
      border-radius: var(--el-border-radius-round);
      color: var(--el-color-warning-dark-2);
      background: var(--el-color-warning-light-9);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &.narrow {
    .mockBadge { display: none; }
  }

  .searchRow {
    display: flex;
    min-width: 0;

    .searchInput { flex: 1; min-width: 0; }
  }

  .selectionRow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 2px 0;

    .selectionText {
      flex: 1;
      min-width: 90px;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .el-button {
      margin: 0;
      padding: 4px 6px;
    }
  }
}

:global(.assetToolbarMenu .menuHeading) {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}
:global(.assetToolbarMenu .dangerItem:not(.is-disabled)) {
  color: var(--el-color-danger);
}
</style>
