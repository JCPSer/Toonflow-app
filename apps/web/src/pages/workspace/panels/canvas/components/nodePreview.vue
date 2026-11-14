<template>
  <!-- ACT: 图片走 Element Plus 的查看器（缩放/旋转/拖拽现成），媒体走弹窗 + 原生播放器；
       播放互斥由全局 installMediaPlayback 收敛，这里不需要额外协调。 -->
  <el-image-viewer
    v-if="target?.kind === 'image' && source && !error"
    :url-list="[source]"
    teleported
    @close="emit('close')" />

  <el-dialog
    v-else-if="visible"
    :model-value="true"
    :title="target?.title"
    width="min(1200px, calc(100vw - 32px))"
    align-center
    append-to-body
    destroy-on-close
    @update:model-value="emit('close')">
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <video
      v-else-if="target?.kind === 'video'"
      :key="source"
      ref="player"
      class="nodePreviewVideo"
      :src="source"
      :aria-label="target?.title"
      controls
      playsinline
      @error="error = '视频无法播放，文件可能已损坏或编码不受支持。'" />
    <audio
      v-else
      :key="source"
      ref="player"
      class="nodePreviewAudio"
      :src="source"
      :aria-label="target?.title"
      controls
      @error="error = '音频无法播放，文件可能已损坏或编码不受支持。'" />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import axios from "axios";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import type { NodePreviewTarget } from "../nodePreview";

const props = defineProps<{ target?: NodePreviewTarget; directory?: string }>();
const emit = defineEmits<{ close: [] }>();

const source = ref("");
const error = ref("");
const player = ref<HTMLMediaElement>();

// ACT: 图片在拿到地址前什么都不渲染（避免闪一个空弹窗）；媒体弹窗可以先出来承载标题与错误。
const visible = computed(() => !!props.target && (!!error.value || (props.target.kind !== "image" && !!source.value)));

/** 绝对地址（远端/已解析的 blob）直接用，只有工作区相对路径才需要经文件层读成 blob。 */
function isAbsolute(url: string) {
  return /^(?:blob|data|file|https?):/i.test(url);
}

/**
 * ACT: 节点产物里存的是工作区相对路径（assets/<nodeId>/x.png），直接塞给 <img>/<video>
 * 会被解析成应用根下的 404。这里按项目目录解析成 blob URL，并在切换/关闭时 release。
 */
watch([() => props.directory, () => props.target] as const, async ([directory, target], _previous, onCleanup) => {
  source.value = "";
  error.value = "";
  if (!target) return;
  if (isAbsolute(target.url)) {
    source.value = target.url;
    return;
  }
  if (!directory) {
    error.value = "缺少项目目录，无法读取预览文件";
    return;
  }
  const handle = useWorkspaceFiles(directory).acquireUrl(target.url, target.mimeType);
  onCleanup(() => handle.release());
  try {
    source.value = await handle.url;
  } catch (cause) {
    error.value = axios.isAxiosError<{ message?: string }>(cause)
      ? cause.response?.data?.message || "预览文件读取失败"
      : cause instanceof Error ? cause.message : "预览文件读取失败";
  }
}, { immediate: true });

// ACT: 地址是异步解析出来的，autoplay 属性到那时已经不在用户激活窗口内；主动 play 一次，
// 被系统拒绝就静默失败，控件仍在，用户可以自己点播放。
watch(source, async (url) => {
  if (!url) return;
  await nextTick();
  void player.value?.play().catch(() => {});
});
</script>

<style scoped lang="scss">
.nodePreviewVideo {
  display: block;
  width: 100%;
  max-height: 72dvh;
  background: #000;
}

.nodePreviewAudio {
  display: block;
  width: 100%;
}
</style>
