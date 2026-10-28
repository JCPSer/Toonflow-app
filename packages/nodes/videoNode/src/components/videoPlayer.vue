<template>
  <div ref="rootElement" class="videoPlayer" @pointerenter="clearIdle" @pointerleave="scheduleIdle">
    <video
      v-if="hasSource"
      ref="video"
      class="videoPreview"
      :class="{ nodrag: fullscreen }"
      :src="src"
      :poster="poster"
      :controls="fullscreen"
      playsinline
      preload="auto"
      draggable="false"
      :aria-label="label"
      @fullscreenchange="fullscreen = !!video?.matches(':fullscreen')"
      @loadedmetadata="readMetadata"
      @loadeddata="readPreview"
      @timeupdate="currentTime = video?.currentTime ?? 0"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @volumechange="readVolume"
      @error="mediaError" />
    <div v-if="!hasSource" class="posterStage" :class="{ empty: !posterUrl }">
      <img v-if="posterUrl" class="posterImage" :src="posterUrl" :alt="label" draggable="false" @load="readPosterSize" />
      <el-button class="posterPlay" circle :icon="IconPlayerPlay" :loading="activating" aria-label="播放视频" title="播放" @click.stop="requestPlay" />
    </div>
    <div v-show="!fullscreen" class="playerControls nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
      <el-button class="playerButton playButton" text circle :icon="playing ? IconPlayerPause : IconPlayerPlay" :disabled="hasSource && !ready" :aria-label="playing ? '暂停视频' : '播放视频'" :title="playing ? '暂停' : '播放'" @click="requestPlay" />
      <span class="currentTime">{{ formatTime(currentTime) }}</span>
      <el-slider class="progressSlider" :modelValue="currentTime" :min="0" :max="duration || 1" :step="0.01" :disabled="!ready || !duration" :show-tooltip="Boolean(ready && duration)" :formatTooltip="formatTime" aria-label="视频播放进度" @input="seek" />
      <span class="durationLabel"><span class="timeSeparator">/</span>{{ formatTime(duration) }}</span>
      <div class="volumeControl">
        <el-popover trigger="hover" placement="top" :width="40" :popperStyle="{ minWidth: '40px', padding: '8px 0', borderRadius: 'var(--el-border-radius-base)' }" :showArrow="false" :showAfter="80" :hideAfter="150" :disabled="!ready">
          <template #reference>
            <el-button class="playerButton volumeButton" text circle :icon="muted || !volume ? IconVolumeOff : IconVolume" :disabled="!ready" :aria-pressed="muted || !volume" :aria-label="muted || !volume ? '取消静音' : '静音视频'" title="音量 · 点击切换静音" @click="toggleMute" />
          </template>
          <div class="volumePanel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop @dblclick.stop @keydown.stop>
            <span class="volumeValue">{{ muted ? 0 : volume }}%</span>
            <el-slider class="volumeSlider" :modelValue="muted ? 0 : volume" vertical height="60px" :min="0" :max="100" :showTooltip="false" aria-label="视频音量" @input="setVolume" />
          </div>
        </el-popover>
      </div>
      <el-dropdown v-if="!readOnly && files" class="captureMenu" trigger="click" placement="top-end" :disabled="capturing" @visibleChange="captureMenuVisible = $event" @command="captureFrame">
        <el-button class="playerButton" text circle :icon="IconPhotoScan" :loading="capturing" :disabled="capturing" :aria-expanded="captureMenuVisible" aria-label="截取视频帧" title="截取视频帧" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="current" :icon="IconPhotoScan">截取当前帧</el-dropdown-item>
            <el-dropdown-item command="first" :icon="IconPlayerSkipBack">截取首帧</el-dropdown-item>
            <el-dropdown-item command="last" :icon="IconPlayerSkipForward">截取尾帧</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useNode, useVueFlow } from "@vue-flow/core";
import { ElButton, ElDropdown, ElDropdownMenu, ElDropdownItem, ElMessage, ElPopover, ElSlider } from "element-plus";
import { IconPlayerPlay, IconPlayerPause, IconVolume, IconVolumeOff, IconPhotoScan, IconPlayerSkipBack, IconPlayerSkipForward } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import { revealNodeInViewport } from "@toonflow/nodes-scaffold/runtime";

const { src, posterUrl = "", label = "节点视频", readOnly = false, resolveSource } = defineProps<{ src: string; posterUrl?: string; label?: string; readOnly?: boolean; resolveSource?: () => Promise<void> }>();
// ACT: 海报态由父层提供首帧图；src 为空时只显示海报，用户点播放才 emit activate 索取视频。
const emit = defineEmits<{ loadedmetadata: [event: Event]; posterSize: [width: number, height: number]; activate: []; deactivate: [] }>();
const video = ref<HTMLVideoElement>();
const rootElement = ref<HTMLElement>();
const fullscreen = ref(false);
const ready = ref(false);
const poster = ref("");
const playing = ref(false);
const muted = ref(false);
const volume = ref(100);
let lastVolume = 100;
const currentTime = ref(0);
const duration = ref(0);
const capturing = ref(false);
const captureMenuVisible = ref(false);
const activating = ref(false);
const hasSource = computed(() => Boolean(src));
// ACT: 暂停/播完后闲置 30s 卸载视频与 Blob，避免「播过一次」的节点长期占内存。
const idleDelayMs = 30000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let pendingPlay = false;
// ACT: 只读预览挂载时不连接节点和工作区；从只读切换到编辑模式时重新挂载播放器。
const node = readOnly ? undefined : useNode().node;
const flow = readOnly ? undefined : useVueFlow();
const files = readOnly ? undefined : useNodeFiles();
const getCanvas = inject<(() => { id: string } | undefined) | undefined>("canvas", undefined);
let captureController: AbortController | undefined;
// ACT: 海报态截帧要先等父层激活出 src，这期间的 src 变化不能当成"换视频"中止本次截帧。
let awaitingSource = false;

watch(() => getCanvas?.()?.id, () => captureController?.abort(), { flush: "sync" });
watch(() => readOnly, value => { if (value) captureController?.abort(); }, { flush: "sync" });
watch(() => src, () => {
  closeHoverOverlays();
  if (awaitingSource) return;
  captureController?.abort();
  ready.value = false;
  poster.value = "";
  playing.value = false;
  currentTime.value = 0;
  duration.value = 0;
}, { flush: "sync" });
onBeforeUnmount(() => {
  captureController?.abort();
  clearIdle();
  closeHoverOverlays();
});

watch(playing, value => {
  if (value) {
    clearIdle();
    pendingPlay = false;
  } else scheduleIdle();
});

watch(ready, value => {
  if (!value) return;
  activating.value = false;
  if (pendingPlay) void startPlayback();
});

/**
 * ACT: 播放器被卸载/切换成海报态时，若鼠标正停在进度条上，Element Plus 的 slider tooltip 会残留在 body 上。
 * 主动派发离开事件并关闭没有触发器的浮层，避免「0:00」这种气泡永久挂在画布上。
 */
function closeHoverOverlays() {
  const root = rootElement.value;
  if (root) {
    for (const element of root.querySelectorAll(".el-slider__button-wrapper, .el-slider__button, .el-slider__runway")) {
      element.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    }
  }
  for (const popper of document.querySelectorAll<HTMLElement>("body > .el-popper")) {
    const describedBy = popper.id;
    const trigger = describedBy ? document.querySelector(`[aria-describedby="${describedBy}"]`) : null;
    if (!trigger) popper.style.display = "none";
  }
}

function clearIdle() {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = undefined;
}

function scheduleIdle() {
  if (readOnly) return;
  clearIdle();
  if (playing.value) return;
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (playing.value || !hasSource.value) return;
    closeHoverOverlays();
    emit("deactivate");
  }, idleDelayMs);
}

// ACT: 海报态点击播放只做「激活」；真实视频挂载后再自动开播。
function requestPlay() {
  if (!hasSource.value) {
    pendingPlay = true;
    activating.value = true;
    emit("activate");
    return;
  }
  void togglePlayback();
}

async function startPlayback() {
  if (!video.value) return;
  try { await video.value.play(); }
  catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) ElMessage.error("视频播放失败"); }
}

/** 海报尺寸用于节点定宽，避免激活后节点宽度跳变。 */
function readPosterSize(event: Event) {
  const source = event.currentTarget as HTMLImageElement;
  if (!source.naturalWidth || !source.naturalHeight) return;
  emit("posterSize", source.naturalWidth, source.naturalHeight);
}

async function enterFullscreen() {
  if (!video.value) return;
  fullscreen.value = true;
  try {
    await video.value.requestFullscreen();
  } catch {
    fullscreen.value = false;
    ElMessage.error("无法进入视频全屏");
  }
}

defineExpose({ enterFullscreen, ready, capturing, captureFrame });

function formatTime(value: number) {
  const seconds = Math.floor(Number.isFinite(value) ? Math.max(0, value) : 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function readMetadata(event: Event) {
  const value = video.value?.duration ?? 0;
  duration.value = Number.isFinite(value) ? value : 0;
  emit("loadedmetadata", event);
}

function readPreview(event: Event) {
  const source = event.currentTarget as HTMLVideoElement;
  if (source.currentSrc !== src) return;
  ready.value = true;
  // ACT: 已有服务端首帧图时不再用 canvas 重复生成，省一次同步绘制。
  if (posterUrl || poster.value || !source.videoWidth || !source.videoHeight) return;
  try {
    const canvas = document.createElement("canvas");
    // ACT: 复用已解码帧，封面最长边限制为 640px；更高清画面由视频播放提供。
    const scale = Math.min(1, 640 / Math.max(source.videoWidth, source.videoHeight));
    canvas.width = Math.max(1, Math.round(source.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(source.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    poster.value = canvas.toDataURL("image/jpeg", 0.8);
  } catch (error) {
    console.warn("视频封面生成失败", error);
  }
}

function mediaError() {
  ready.value = false;
  playing.value = false;
  ElMessage.error("无法预览该视频");
}

async function togglePlayback() {
  if (!video.value) return;
  if (playing.value) video.value.pause();
  else {
    try { await video.value.play(); }
    catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) ElMessage.error("视频播放失败"); }
  }
}

function seek(value: number | number[]) {
  if (!video.value || !Number.isFinite(value)) return;
  video.value.currentTime = Math.min(duration.value, Math.max(0, Number(value)));
  currentTime.value = video.value.currentTime;
}

function readVolume() {
  if (!video.value) return;
  volume.value = Math.round(video.value.volume * 100);
  muted.value = video.value.muted;
  if (volume.value > 0) lastVolume = volume.value;
}

function setVolume(value: number | number[]) {
  if (!video.value || typeof value !== "number" || !Number.isFinite(value)) return;
  video.value.volume = Math.min(100, Math.max(0, value)) / 100;
  video.value.muted = video.value.volume === 0;
  readVolume();
}

function toggleMute() {
  if (!video.value) return;
  const silent = video.value.muted || video.value.volume === 0;
  if (video.value.volume === 0) video.value.volume = lastVolume / 100;
  video.value.muted = !silent;
  readVolume();
}

// ACT: 取帧必须让 video 参与渲染。WKWebView 里未挂到文档的 video 即使 seeked 且 readyState=4，
// drawImage 仍可能画出一张全透明画布（用户看到的就是「截出来是空白图片」）。这里挂进一个离屏容器，
// 并在 seeked 之后再等 requestVideoFrameCallback 报告真正呈现了一帧，才交给调用方绘制。
function loadFrame(source: HTMLVideoElement, srcUrl: string, mode: { kind: "time"; time: number } | { kind: "last" }, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("视频帧读取超时")), 15000);
    function finish(error?: unknown) {
      clearTimeout(timer);
      source.onloadedmetadata = null;
      source.onseeked = null;
      source.onerror = null;
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    }
    function abort() { finish(signal.reason); }
    // ACT: 只有 seeked 才代表解码器出了新画面；loadedmetadata 时 readyState 可能已 ≥2，据此判断会画到旧帧/黑帧。
    source.onloadedmetadata = () => {
      const total = source.duration;
      if (!Number.isFinite(total) || total <= 0) return finish(new Error("无法读取视频时长"));
      const last = Math.max(0, total - 0.05);
      // ACT: 首帧固定取 0.05s 触发一次真实 seek；目标时间恰好等于当前时间时不会派发 seeked，会一直等到超时。
      // ACT: last 在极短视频上会算成 0，与当前时间同值不会派发 seeked，至少留 0.01s 才能触发真实 seek。
      const target = mode.kind === "last" ? Math.max(0.01, last) : Math.max(0.05, Math.min(mode.time, last || 0.05));
      // ACT: rvfc 必须在设置 currentTime 之前注册——seek 完成时那一帧已经呈现过了，
      // 等 seeked 再注册就永远不会再触发（暂停元素没有后续呈现），只剩超时兜底。
      const presented = presentedFrame(source, target).then(() => nextPaint());
      source.onseeked = () => {
        if (source.readyState < 2 || !source.videoWidth) return finish(new Error("视频帧尚未就绪"));
        void presented.then(() => finish());
      };
      source.currentTime = target;
    };
    source.onerror = () => finish(new Error("无法读取视频帧"));
    signal.addEventListener("abort", abort, { once: true });
    source.src = srcUrl;
    source.load();
    if (signal.aborted) abort();
  });
}

// ACT: seeked 只保证解码器有数据，不保证帧已进入可绘制状态。等 rvfc 报告「落在目标时间附近的帧已呈现」，
// 订阅到不符的旧帧就继续等下一帧；没有 rvfc 的老 WebKit 退回一帧 rAF。600ms 超时兜底，避免永久等待。
function presentedFrame(source: HTMLVideoElement, mediaTime: number) {
  return new Promise<void>(resolve => {
    type FrameRequest = (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
    const request = (source as HTMLVideoElement & { requestVideoFrameCallback?: FrameRequest }).requestVideoFrameCallback;
    const cancel = (source as HTMLVideoElement & { cancelVideoFrameCallback?: (handle: number) => void }).cancelVideoFrameCallback;
    let settled = false;
    let handle: number | undefined;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (handle !== undefined && typeof cancel === "function") cancel.call(source, handle);
      resolve();
    };
    const timer = window.setTimeout(settle, 600);
    if (typeof request !== "function") {
      requestAnimationFrame(() => settle());
      return;
    }
    const listen = () => {
      handle = request.call(source, (_now, metadata) => {
        // 只看目标时间附近的帧：seek 刚下发时可能先收到解析阶段的旧帧。
        if (Math.abs(metadata.mediaTime - mediaTime) > 0.15) {
          listen();
          return;
        }
        settle();
      });
    };
    listen();
  });
}

// ACT: 两帧 rAF 保证绘制前至少完成一次合成，避免 drawImage 读到尚未上屏的内容。
function nextPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

// ACT: 重试时只「等」不会产生新帧。真的把时间戳挪 40ms 再 seek 一次，逼解码器重新出帧。
async function nudgeFrame(source: HTMLVideoElement, signal: AbortSignal) {
  const from = source.currentTime;
  const target = from < 0.5
    ? Math.min(Math.max(0.05, source.duration - 0.01), from + 0.04)
    : Math.max(0.01, from - 0.04);
  const presented = presentedFrame(source, target);
  source.currentTime = target;
  await presented;
  await nextPaint();
  signal.throwIfAborted();
}

// ACT: 8×8 缩略采样判断这一帧是否真的画出了内容。drawImage 拿到空帧时画布全透明，
// 此时不能把 PNG 交给用户（会得到一张空白图片节点），必须重试或明确报错。
function isBlankFrame(source: HTMLVideoElement) {
  const probe = document.createElement("canvas");
  probe.width = 8;
  probe.height = 8;
  const context = probe.getContext("2d");
  if (!context) return false;
  context.drawImage(source, 0, 0, 8, 8);
  const data = context.getImageData(0, 0, 8, 8).data;
  for (let index = 3; index < data.length; index += 4) if (data[index]) return false;
  return true;
}

async function captureFrame(command: "current" | "first" | "last") {
  if (readOnly || !node || !flow || !files || capturing.value) return;
  const { addNodes, findNode, getNodes, nodeTypes } = flow;
  if (!nodeTypes?.value?.["remote-imageNode"]) return void ElMessage.error("请先启用图片节点插件");
  capturing.value = true;
  const id = crypto.randomUUID();
  let frameVideo: HTMLVideoElement | undefined;
  // ACT: 解码用的 video 必须一直是文档里的元素（离屏容器），否则 WKWebView 下 drawImage 会拿到空帧。
  // 容器活到本次截帧结束才移除，不能随 loadFrame 结束就摘掉。
  let frameHolder: HTMLDivElement | undefined;
  let uploadStarted = false;
  let committed = false;
  let workspace: ReturnType<NonNullable<typeof files>["getWorkspaceFiles"]> | undefined;
  let controller: AbortController | undefined;
  try {
    // ACT: controller 必须在 await 前建好，激活期间的切画布/卸载/只读切换才能中止本次截帧。
    controller = captureController = new AbortController();
    // ACT: 海报态没有 <video>，先让父层激活视频源；期间 src 变化是本次激活的结果，不能中止截帧。
    if (!src && resolveSource) {
      awaitingSource = true;
      try { await resolveSource(); }
      catch { return; } // ACT: activate 内部已提示过读取失败，这里不重复弹错。
      finally { awaitingSource = false; }
    }
    controller.signal.throwIfAborted();
    const srcUrl = src;
    if (!srcUrl) throw new Error("视频尚未就绪，请稍后重试");
    // ACT: 统一用独立元素解码，既不打断播放也不改变播放进度。
    frameVideo = document.createElement("video");
    frameVideo.muted = true;
    frameVideo.preload = "auto";
    frameHolder = document.createElement("div");
    frameHolder.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;overflow:hidden;pointer-events:none;";
    frameHolder.appendChild(frameVideo);
    document.body.appendChild(frameHolder);
    // ACT: 海报态没有播放器元素，"当前帧"退化为首帧，明确告知而不是静默给出别的画面。
    if (command === "current" && !video.value) ElMessage.info("视频尚未播放，已截取首帧");
    const currentSeconds = video.value?.currentTime ?? 0;
    const mode = command === "last" ? { kind: "last" as const } : { kind: "time" as const, time: command === "first" ? 0 : currentSeconds };
    await loadFrame(frameVideo, srcUrl, mode, controller.signal);
    const source = frameVideo;
    controller.signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) throw new Error("视频帧尚未就绪");
    // ACT: 空帧不能提交。画出来若全透明说明这一帧没有真正解码，等下一帧呈现后重画；
    // 3 次仍为空就明确报错，避免把透明 PNG 存成一张空白图片节点。
    for (let attempt = 0; ; attempt++) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0);
      if (!isBlankFrame(source)) break;
      if (attempt >= 2) throw new Error("视频帧解码失败，请重试");
      await nudgeFrame(source, controller.signal);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("截图生成失败")), "image/png"));
    controller.signal.throwIfAborted();
    const frameLabel = { current: "当前帧", first: "首帧", last: "尾帧" }[command];
    const name = `${node.data.label || label} · ${frameLabel}`;
    if (findNode(node.id) !== node) throw new Error("画布节点已变化，请重新截帧");
    workspace = files.getWorkspaceFiles();
    uploadStarted = true;
    const path = await files.uploadFile(id, new File([blob], "frame.png", { type: "image/png" }));
    controller.signal.throwIfAborted();
    if (findNode(node.id) !== node || !nodeTypes?.value?.["remote-imageNode"]) throw new Error("画布节点已变化，请重新截帧");
    const x = node.computedPosition.x + node.dimensions.width + 40;
    let y = node.computedPosition.y;
    const width = 240 * canvas.width / canvas.height + 18;
    for (const other of [...getNodes.value].sort((a, b) => a.computedPosition.y - b.computedPosition.y)) {
      const position = other.computedPosition;
      if (position.x < x + width && position.x + other.dimensions.width > x && position.y < y + 300 && position.y + other.dimensions.height > y) y = position.y + other.dimensions.height + 24;
    }
    addNodes({ id, type: "remote-imageNode", position: { x, y }, data: { label: name, outputs: { image: { dataType: "IMAGE", value: { url: path, mimeType: "image/png" } } } } });
    // ACT: 截出的节点默认摆在源节点右侧并向下的空位，源节点贴着视口边缘时会落到屏外，这里补一次跟随。
    await revealNodeInViewport(flow, id, { margin: 40 });
    committed = true;
    ElMessage.success("已截取为图片节点");
  } catch (error) {
    if (!controller?.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "截帧失败");
  } finally {
    frameHolder?.remove();
    frameHolder = undefined;
    if (frameVideo) { frameVideo.removeAttribute("src"); frameVideo.load(); }
    if (uploadStarted && !committed) {
      await workspace!.remove(`assets/${id}`, true).catch(error => {
        if (error?.response?.data?.data?.code !== "ENOENT") ElMessage.error("截帧中断，临时图片清理失败");
      });
    }
    capturing.value = false;
    captureController = undefined;
    // ACT: 截帧可能刚从海报态激活出视频，鼠标一直在节点上不会触发 pointerleave，主动排一次闲置释放。
    scheduleIdle();
  }
}
</script>

<style scoped lang="scss">
.videoPlayer {
  position: relative;
  width: 100%;
  min-width: 180px;
  container-type: inline-size;
  border-radius: var(--el-border-radius-base);
  background: var(--el-fill-color-darker);
  cursor: grab;

  &:active { cursor: grabbing; }
  .posterStage {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    min-height: 84px;
    max-height: 240px;
    overflow: hidden;
    background: var(--el-fill-color-darker);

    &.empty { min-height: 84px; }
    .posterImage {
      display: block;
      width: 100%;
      max-height: 240px;
      object-fit: contain;
    }
    .posterPlay {
      position: absolute;
      width: 46px;
      height: 46px;
      font-size: 22px;
      color: #fff;
      background: rgb(0 0 0 / 45%);
      border: none;
      backdrop-filter: none;
      &:hover { background: rgb(0 0 0 / 65%); }
    }
  }
  .videoPreview {
    display: block;
    width: 100%;
    max-height: 240px;
    object-fit: contain;
    border-radius: var(--el-border-radius-base);
    pointer-events: none;

    &:fullscreen {
      height: 100%;
      max-height: none;
      border-radius: 0;
      background: #000;
      pointer-events: auto;
      cursor: default;
    }
  }
  .playerControls {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: 28px auto minmax(0, 1fr) 28px 28px;
    grid-template-areas: "progress progress progress progress progress" "play current duration volume capture";
    align-items: center;
    gap: 2px 3px;
    padding: 8px 8px 4px;
    border-radius: 0 0 var(--el-border-radius-base) var(--el-border-radius-base);
    background: linear-gradient(transparent, color-mix(in srgb, var(--el-bg-color-overlay) 85%, transparent));
    color: var(--el-text-color-primary);
    cursor: default;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;

    .playerButton {
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
      font-size: 15px;
      &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
    }
    .playButton { grid-area: play; }
    .volumeControl {
      grid-area: volume;
      .volumeButton { color: var(--el-text-color-regular); }
    }
    .captureMenu { grid-area: capture; }
    .currentTime, .durationLabel {
      white-space: nowrap;
      font-size: 10px;
      line-height: 16px;
      font-variant-numeric: tabular-nums;
    }
    .currentTime { grid-area: current; text-align: right; }
    .durationLabel {
      grid-area: duration;
      color: var(--el-text-color-secondary);
      .timeSeparator { margin-right: 3px; color: var(--el-text-color-placeholder); }
    }
    .progressSlider {
      grid-area: progress;
      min-width: 0;
      width: calc(100% - 8px);
      justify-self: center;
      height: 16px;
      --el-slider-height: 2px;
      --el-slider-button-size: 8px;
      --el-slider-button-wrapper-size: 22px;

      :deep(.el-slider__button-wrapper) {
        top: 50%;
        display: grid;
        place-items: center;
        transform: translate(-50%, -50%);

        &::after { display: none; }
      }
    }

    @container (min-width: 320px) {
      grid-template-columns: 28px auto minmax(32px, 1fr) auto 28px 28px;
      grid-template-areas: "play current progress duration volume capture";
      gap: 6px;
      padding: 8px 8px 4px;
      .currentTime, .durationLabel { font-size: 11px; }
      .durationLabel .timeSeparator { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { transition: none; }
  }
  &:hover .playerControls, .playerControls:has(:focus-visible) {
    opacity: 1;
    pointer-events: auto;
  }
}
.volumePanel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-bottom: 4px;

  .volumeValue { color: var(--el-text-color-secondary); font-size: 10px; line-height: 14px; font-variant-numeric: tabular-nums; }
  .volumeSlider {
    --el-slider-height: 2px;
    --el-slider-button-size: 8px;
    --el-slider-button-wrapper-size: 22px;

    :deep(.el-slider__button-wrapper) {
      left: 50%;
      display: grid;
      place-items: center;
      transform: translate(-50%, 50%);

      &::after { display: none; }
    }
  }
}
</style>
