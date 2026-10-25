<template>
  <section class="assetGridView" :aria-label="translate('素材内容')">
    <nav v-if="view === 'folder' || query" class="breadcrumb" :aria-label="translate('当前目录')">
      <el-button
        class="upButton"
        text
        size="small"
        :icon="IconArrowLeft"
        :disabled="!currentPath"
        :aria-label="translate('上一级')"
        :title="translate('上一级')"
        @click="emit('navigate', parentPath)" />
      <button type="button" class="crumb" :class="{ current: !currentPath }" :disabled="!currentPath" @click="emit('navigate', '')">
        {{ libraryName }}
      </button>
      <template v-for="part in breadcrumb" :key="part.path">
        <icon-chevron-right :size="12" aria-hidden="true" />
        <button type="button" class="crumb" :class="{ current: part.path === currentPath }" @click="emit('navigate', part.path)">{{ part.name }}</button>
      </template>
      <span v-if="query" class="searchHint"><icon-search :size="12" aria-hidden="true" />{{ translate("搜索结果") }}</span>
    </nav>

    <div
      ref="scrollElement"
      v-loading="loading"
      class="assetScroll"
      :class="{ dropTarget: dropActivePath === currentPath && dropActivePath !== undefined }"
      role="listbox"
      tabindex="-1"
      :aria-multiselectable="true"
      :aria-busy="loading || loadingMore"
      @scroll.passive="onScroll"
      @click.self="onBlankClick"
      @contextmenu.self.prevent="emit('background-menu', $event)"
      @dragover="onBlankDragOver"
      @dragleave="onBlankDragLeave"
      @drop="onBlankDrop">
      <div
        v-if="entries.length"
        class="assetGrid"
        tabindex="-1"
        @click.self="onBlankClick"
        @contextmenu.self.prevent="emit('background-menu', $event)">
        <article
          v-for="entry in entries"
          :key="entry.path"
          class="assetCard"
          :class="{ selected: selection.has(entry.path), favorite: entry.favorite, dropTarget: dropActivePath === entry.path }"
          role="option"
          :aria-selected="selection.has(entry.path)"
          :aria-label="entryAriaLabel(entry)"
          tabindex="-1"
          draggable="true"
          @click="handleClick($event, entry)"
          @dblclick.stop="emit('open', entry)"
          @contextmenu.prevent.stop="emit('menu', $event, entry)"
          @dragstart="onDragStart($event, entry)"
          @dragend="onDragEnd"
          @dragover="onCardDragOver($event, entry)"
          @dragleave="onCardDragLeave($event, entry)"
          @drop="onCardDrop($event, entry)">
          <span class="assetVisual">
            <template v-if="entry.type === 'directory'">
              <icon-folder :size="46" stroke="1.25" aria-hidden="true" />
            </template>
            <template v-else-if="mediaKind(entry) === 'image'">
              <img
                v-if="!failedImages.has(entry.path)"
                class="assetImage"
                :src="imageSrc(entry)"
                :alt="entry.name"
                loading="lazy"
                decoding="async"
                draggable="false"
                @error="onImageError(entry)" />
              <icon-photo v-else :size="34" stroke="1.25" aria-hidden="true" />
            </template>
            <template v-else-if="mediaKind(entry) === 'video'">
              <video v-if="videoSrc(entry)" class="assetVideo" :src="videoSrc(entry)" preload="metadata" muted playsinline aria-hidden="true" />
              <span class="playBadge"><icon-player-play :size="20" fill="currentColor" aria-hidden="true" /></span>
            </template>
            <icon-music v-else-if="mediaKind(entry) === 'audio'" :size="36" stroke="1.25" aria-hidden="true" />
            <icon-file v-else :size="36" stroke="1.25" aria-hidden="true" />
            <span v-if="entry.favorite" class="favoriteStar" :title="translate('已收藏')"><icon-star-filled :size="14" aria-hidden="true" /></span>
            <span class="typeBadge">{{ categoryLabel(entry) }}</span>
            <span class="moreWrap">
              <el-button
                class="moreButton"
                text
                size="small"
                :icon="IconDots"
                :aria-label="translate('更多操作：{name}', { name: entry.name })"
                :title="translate('更多操作')"
                @click.stop="emit('menu', $event, entry)" />
            </span>
          </span>
          <span class="assetName" :title="entry.path">{{ entry.name }}</span>
          <span class="assetMeta">
            <span v-if="entry.type === 'directory'">{{ translate('{count} 项', { count: entry.childCount ?? 0 }) }}</span>
            <span v-else>{{ formatAssetSize(entry.size) }}</span>
            <span v-if="query && entry.path.includes('/')" class="assetLocation" :title="parentLocation(entry.path)">{{ parentLocation(entry.path) }}</span>
          </span>
        </article>
      </div>

      <AssetEmptyState
        v-else-if="!loading"
        :kind="emptyKind"
        :loading="loading"
        @upload="emit('upload')"
        @create-folder="emit('create-folder')"
        @refresh="emit('refresh')"
        @clear-search="emit('clear-search')"
        @switch-global="emit('switch-global')" />

      <div v-if="loadingMore" class="loadMore">{{ translate("正在加载更多…") }}</div>
      <div v-else-if="entries.length && !hasMore" class="loadEnd">{{ translate("已加载全部素材") }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { translate } from "@toonflow/i18n/vue";
import {
  IconArrowLeft, IconChevronRight, IconDots, IconFile, IconFolder, IconMusic, IconPhoto, IconPlayerPlay,
  IconSearch, IconStarFilled,
} from "@tabler/icons-vue";
import AssetEmptyState from "./AssetEmptyState.vue";
import { assetReadUrl, assetThumbnailUrl } from "../api";
import {
  activeAssetDrag, assetKind, canDropInto, clearAssetDrag, formatAssetSize, hasFileDrag, hasInternalDrag,
  readInternalDrag, setCanvasDragPayload, setInternalDrag,
} from "../types";
import type { AssetDragPayload, AssetEntry, AssetLibraryKind, AssetView } from "../types";

const props = withDefaults(defineProps<{
  entries: AssetEntry[];
  selection: Set<string>;
  library: AssetLibraryKind;
  directory?: string;
  view: AssetView;
  currentPath: string;
  query?: string;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  emptyKind?: "loading" | "directory" | "search" | "rebuilding" | "project-unavailable";
}>(), { query: "", loading: false, loadingMore: false, hasMore: false, emptyKind: "directory" });
const emit = defineEmits<{
  select: [entry: AssetEntry, mode: "single" | "toggle" | "range"];
  open: [entry: AssetEntry];
  menu: [event: MouseEvent, entry: AssetEntry];
  navigate: [path: string];
  move: [payload: AssetDragPayload, targetPath: string];
  "upload-drop": [files: File[], targetPath: string];
  "load-more": [];
  "clear-selection": [];
  "background-menu": [event: MouseEvent];
  "create-folder": [];
  upload: [];
  refresh: [];
  "clear-search": [];
  "switch-global": [];
  error: [message: string];
}>();

const scrollElement = ref<HTMLElement>();
const dropActivePath = ref<string>();
const failedImages = ref(new Set<string>());
const fallbackImages = ref(new Set<string>());

const selector = computed(() => ({ library: props.library, directory: props.directory }));
const breadcrumb = computed(() => props.currentPath
  ? props.currentPath.split("/").map((name, index, parts) => ({ name, path: parts.slice(0, index + 1).join("/") }))
  : []);
const parentPath = computed(() => props.currentPath.split("/").slice(0, -1).join("/"));
const libraryName = computed(() => props.library === "project" ? translate("本项目") : translate("全局"));

function mediaKind(entry: AssetEntry) {
  const kind = assetKind(entry);
  return kind === "image" || kind === "video" || kind === "audio" ? kind : undefined;
}

function imageSrc(entry: AssetEntry) {
  return fallbackImages.value.has(entry.path) ? assetReadUrl(selector.value, entry.path) : assetThumbnailUrl(selector.value, entry.path);
}

function videoSrc(entry: AssetEntry) {
  const url = assetReadUrl(selector.value, entry.path);
  return url ? `${url}#t=0.1` : "";
}

function onImageError(entry: AssetEntry) {
  if (!fallbackImages.value.has(entry.path)) {
    fallbackImages.value = new Set([...fallbackImages.value, entry.path]);
    return;
  }
  failedImages.value = new Set([...failedImages.value, entry.path]);
}

function categoryLabel(entry: AssetEntry) {
  const kind = assetKind(entry);
  if (kind === "directory") return translate("文件夹");
  if (kind === "image") return translate("图片");
  if (kind === "video") return translate("视频");
  if (kind === "audio") return translate("音频");
  if (kind === "document") return translate("文档");
  return translate("文件");
}

function entryAriaLabel(entry: AssetEntry) {
  return `${categoryLabel(entry)} ${entry.name}`;
}

function parentLocation(path: string) {
  return path.split("/").slice(0, -1).join(" / ");
}

function handleClick(event: MouseEvent, entry: AssetEntry) {
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  emit("select", entry, event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "single");
}

function dragPayload(entry: AssetEntry): AssetDragPayload {
  return { library: props.library, path: entry.path, name: entry.name, type: entry.type };
}

function onDragStart(event: DragEvent, entry: AssetEntry) {
  const payload = dragPayload(entry);
  setInternalDrag(event, payload);
  if (entry.type === "file") setCanvasDragPayload(event, payload, props.directory);
}

function onDragEnd() {
  dropActivePath.value = undefined;
  clearAssetDrag();
}

function canAccept(entry: AssetEntry) {
  return entry.type === "directory";
}

function canDropHere(targetPath: string) {
  const payload = activeAssetDrag.value;
  if (!payload) return false;
  return canDropInto(payload, { library: props.library, path: targetPath }, "directory");
}

function onCardDragOver(event: DragEvent, entry: AssetEntry) {
  if (!canAccept(entry)) return;
  if (!hasInternalDrag(event) && !hasFileDrag(event)) return;
  if (hasInternalDrag(event) && !canDropHere(entry.path)) {
    dropActivePath.value = undefined;
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  dropActivePath.value = entry.path;
  if (event.dataTransfer) event.dataTransfer.dropEffect = hasInternalDrag(event) ? "move" : "copy";
}

function onCardDragLeave(event: DragEvent, entry: AssetEntry) {
  if (dropActivePath.value !== entry.path) return;
  const related = event.relatedTarget;
  if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) return;
  dropActivePath.value = undefined;
}

function onCardDrop(event: DragEvent, entry: AssetEntry) {
  if (!canAccept(entry)) return;
  dropActivePath.value = undefined;
  if (hasInternalDrag(event)) {
    event.preventDefault();
    event.stopPropagation();
    const payload = readInternalDrag(event);
    clearAssetDrag();
    if (payload && payload.library !== props.library) {
      emit("error", translate("请用收藏复制到另一个素材库，素材库之间不支持直接移动"));
      return;
    }
    if (payload && canDropInto(payload, { library: props.library, path: entry.path }, "directory")) emit("move", payload, entry.path);
    return;
  }
  if (hasFileDrag(event)) {
    event.preventDefault();
    event.stopPropagation();
    emit("upload-drop", Array.from(event.dataTransfer?.files ?? []), entry.path);
  }
}

function onBlankDragOver(event: DragEvent) {
  if (!hasInternalDrag(event) && !hasFileDrag(event)) return;
  if (hasInternalDrag(event) && !canDropHere(props.currentPath)) {
    dropActivePath.value = undefined;
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = hasInternalDrag(event) ? "move" : "copy";
  dropActivePath.value = props.currentPath;
}

function onBlankDragLeave(event: DragEvent) {
  if (dropActivePath.value !== props.currentPath) return;
  const related = event.relatedTarget;
  if (related instanceof Node && (event.currentTarget as HTMLElement).contains(related)) return;
  dropActivePath.value = undefined;
}

function onBlankDrop(event: DragEvent) {
  if (hasInternalDrag(event)) {
    event.stopPropagation();
    const payload = readInternalDrag(event);
    dropActivePath.value = undefined;
    clearAssetDrag();
    if (payload && payload.library !== props.library) {
      emit("error", translate("请用收藏复制到另一个素材库，素材库之间不支持直接移动"));
      return;
    }
    if (payload && canDropInto(payload, { library: props.library, path: props.currentPath }, "directory")) emit("move", payload, props.currentPath);
    return;
  }
  if (hasFileDrag(event)) {
    event.preventDefault();
    event.stopPropagation();
    dropActivePath.value = undefined;
    emit("upload-drop", Array.from(event.dataTransfer?.files ?? []), props.currentPath);
  }
}

function onBlankClick(event: MouseEvent) {
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  emit("clear-selection");
}

function onScroll(event: Event) {
  const element = event.target as HTMLElement;
  if (element.scrollHeight - element.scrollTop - element.clientHeight < 180) emit("load-more");
}
</script>

<style scoped lang="scss">
.assetGridView {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;

  .breadcrumb {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 4px;
    min-height: 30px;
    padding: 2px 10px;
    overflow-x: auto;
    border-bottom: 1px solid var(--el-border-color-lighter);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    scrollbar-width: none;

    &::-webkit-scrollbar { display: none; }

    .upButton {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      margin: 0;
      padding: 0;
    }

    svg { flex-shrink: 0; }

    .crumb {
      flex-shrink: 0;
      max-width: 150px;
      overflow: hidden;
      padding: 2px 2px;
      border: 0;
      color: var(--el-text-color-secondary);
      background: transparent;
      font: inherit;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;

      &:hover:not(:disabled) { color: var(--el-color-primary); }
      &.current { color: var(--el-text-color-primary); }
    }

    .searchHint {
      display: inline-flex;
      flex-shrink: 0;
      align-items: center;
      gap: 3px;
      margin-left: auto;
      padding-left: 8px;
      color: var(--el-color-primary);
    }
  }

  .assetScroll {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 10px;
    overscroll-behavior: contain;
    outline: none;

    &.dropTarget {
      background: var(--el-color-primary-light-9);
      box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5);
    }

    .assetGrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(122px, 1fr));
      gap: 10px;
      align-content: start;
    }

    .assetCard {
      display: flex;
      flex-direction: column;
      min-width: 0;
      padding: 6px;
      border: 1px solid transparent;
      border-radius: var(--ui-radius-large, 10px);
      background: transparent;
      cursor: default;
      user-select: none;

      &:hover { background: var(--el-fill-color-light); }
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }

      &.selected {
        border-color: var(--el-color-primary-light-5);
        background: var(--el-color-primary-light-9);
      }

      &.dropTarget {
        border-color: var(--el-color-primary);
        background: var(--el-color-primary-light-9);
      }

      .assetVisual {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 4 / 3;
        overflow: hidden;
        border-radius: var(--el-border-radius-base);
        color: var(--el-text-color-placeholder);
        background: var(--el-fill-color-light);

        .assetImage,
        .assetVideo {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .playBadge {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          color: var(--el-text-color-regular);
          background: color-mix(in srgb, var(--el-bg-color-overlay) 82%, transparent);
        }

        .favoriteStar {
          position: absolute;
          top: 4px;
          left: 5px;
          color: var(--el-color-warning);
          filter: drop-shadow(0 1px 1px rgb(0 0 0 / 35%));
        }

        .typeBadge {
          position: absolute;
          right: 4px;
          bottom: 4px;
          padding: 1px 5px;
          border-radius: var(--el-border-radius-small);
          color: var(--el-text-color-regular);
          background: color-mix(in srgb, var(--el-bg-color-overlay) 88%, transparent);
          font-size: 10px;
          line-height: 14px;
        }

        .moreWrap {
          position: absolute;
          top: 3px;
          right: 3px;
          opacity: 0;
          transition: opacity 0.12s;
        }

        .moreButton {
          width: 24px;
          height: 24px;
          margin: 0;
          padding: 0;
          color: var(--el-text-color-regular);
          background: color-mix(in srgb, var(--el-bg-color-overlay) 88%, transparent);
        }
      }

      &:hover .moreWrap,
      &:focus-within .moreWrap { opacity: 1; }

      .assetName {
        display: block;
        overflow: hidden;
        margin-top: 6px;
        padding: 0 2px;
        font-size: 12px;
        line-height: 17px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .assetMeta {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 1px 2px 0;
        color: var(--el-text-color-secondary);
        font-size: 10px;
        line-height: 14px;

        .assetLocation {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    }

    .loadMore,
    .loadEnd {
      padding: 14px 0 6px;
      color: var(--el-text-color-placeholder);
      font-size: 11px;
      text-align: center;
    }
  }
}
</style>
