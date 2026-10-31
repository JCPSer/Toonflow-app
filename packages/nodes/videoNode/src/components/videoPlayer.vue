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
import { ensureNodeDirectory, useNodeFiles, workspaceMediaPath, type WorkspaceFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import { revealNodeInViewport, useNodeFfmpeg, type BrowserFfmpegCommand } from "@toonflow/nodes-scaffold/runtime";
import { FRAME_EPSILON, frameTarget, type FrameCommand } from "../frameTarget";

const { src, posterUrl = "", label = "节点视频", readOnly = false, resolveSource, sourcePath = "" } = defineProps<{ src: string; posterUrl?: string; label?: string; readOnly?: boolean; resolveSource?: () => Promise<void>; sourcePath?: string }>();
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
// ACT: 记录「当前已呈现帧」的 PTS，供宿主取「当前帧」用：ffmpeg 的 -ss 取第一个 PTS ≥ 目标的帧，
// 只有把目标设成该帧自己的 PTS 才能精确命中；currentTime 是播放头位置，常常落在帧中间。
let presentedMediaTime = Number.NaN;
let trackingSource: HTMLVideoElement | undefined;
let trackingHandle: number | undefined;
// ACT: 只读预览挂载时不连接节点和工作区；从只读切换到编辑模式时重新挂载播放器。
const node = readOnly ? undefined : useNode().node;
// ACT: 宿主侧 ffmpeg 能力（海报态也用它取帧，不需要先把视频读进播放器）。
const nodeFfmpeg = useNodeFfmpeg();
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
  presentedMediaTime = Number.NaN;
  stopTracking();
}, { flush: "sync" });
onBeforeUnmount(() => {
  captureController?.abort();
  stopTracking();
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

/** ACT: 节点被禁用时由宿主调用，退出本播放器发起的原生全屏；不影响其它元素的全屏。 */
async function exitFullscreen() {
  if (!fullscreen.value) return;
  fullscreen.value = false;
  if (document.fullscreenElement && document.fullscreenElement === video.value) {
    await document.exitFullscreen().catch(() => {});
  }
}

defineExpose({ enterFullscreen, exitFullscreen, ready, capturing, captureFrame });

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
  trackPresentedFrame(source);
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
  return new Promise<number>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error("视频帧读取超时")), 15000);
    let target = FRAME_EPSILON;
    function finish(error?: unknown) {
      clearTimeout(timer);
      source.onloadedmetadata = null;
      source.onseeked = null;
      source.onerror = null;
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(target);
    }
    function abort() { finish(signal.reason); }
    // ACT: 只有 seeked 才代表解码器出了新画面；loadedmetadata 时 readyState 可能已 ≥2，据此判断会画到旧帧/黑帧。
    source.onloadedmetadata = () => {
      const total = source.duration;
      if (!Number.isFinite(total) || total <= 0) return finish(new Error("无法读取视频时长"));
      // ACT: 时刻统一由 frameTarget 给：首帧 = 第 1 帧、尾帧 = 最后一帧，都用 0.001s 触发真实 seek。
      target = mode.kind === "last" ? frameTarget("last", total) : frameTarget(mode.time <= 0 ? "first" : "current", total, mode.time);
      // ACT: rvfc 必须在设置 currentTime 之前注册——seek 完成时那一帧已经呈现过了，
      // 等 seeked 再注册就永远不会再触发（暂停元素没有后续呈现），只剩超时兜底。
      const presented = presentedFrame(source).then(() => nextPaint());
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

// ACT: seeked 只保证解码器有数据，不保证帧已进入可绘制状态。等 rvfc 报告「有一帧已呈现」即可：
// 元素是暂停的，seeked 之后呈现的第一帧就是目标帧，不再按时间容差筛选——150ms 容差在 24fps 下宽达 3.6 帧。
// 没有 rvfc 的老 WebKit 退回一帧 rAF；600ms 超时兜底，避免永久等待。
function presentedFrame(source: HTMLVideoElement) {
  return new Promise<void>(resolve => {
    const { request, cancel } = frameCallbacks(source);
    let settled = false;
    let handle: number | undefined;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (handle !== undefined && typeof cancel === "function") cancel(handle);
      resolve();
    };
    const timer = window.setTimeout(settle, 600);
    if (typeof request !== "function") {
      requestAnimationFrame(() => settle());
      return;
    }
    handle = request(() => settle());
  });
}

// ACT: 两帧 rAF 保证绘制前至少完成一次合成，避免 drawImage 读到尚未上屏的内容。
function nextPaint() {
  return new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

// ACT: 重试时只「等」不会产生新帧。真的把时间戳挪 40ms 再 seek 一次，逼解码器重新出帧；
// 出帧后必须回到目标时刻，否则会把「挪动后的帧」当成目标帧交出去（静默换帧）。
async function nudgeFrame(source: HTMLVideoElement, target: number, signal: AbortSignal) {
  const from = source.currentTime;
  const nudge = from < 0.5
    ? Math.min(Math.max(FRAME_EPSILON, source.duration - FRAME_EPSILON), from + 0.04)
    : Math.max(FRAME_EPSILON, from - 0.04);
  const nudged = presentedFrame(source);
  source.currentTime = nudge;
  await nudged;
  await nextPaint();
  signal.throwIfAborted();
  const restored = presentedFrame(source);
  source.currentTime = target;
  await restored;
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

const CAPTURE_TIMEOUT_MS = 20000;

/** ACT: 宿主侧 ffmpeg 取帧。首帧不 seek；尾帧用 -sseof 从末尾 1s 解到结尾、逐帧覆盖同一文件，
 * 落盘即真正的最后一帧；当前帧用已呈现帧自己的 PTS 作 seek 目标（ffmpeg 取第一个 PTS ≥ 目标的帧）。 */
async function captureOnHost(command: FrameCommand, id: string, workspaceFiles: WorkspaceFiles, signal: AbortSignal) {
  // ACT: props 在 await 期间可能变化，进函数先快照。
  const source = workspaceMediaPath(sourcePath);
  // ACT: 截帧自带 canvas 兜底，缺 FFmpeg 时静默失败，不弹安装引导。
  const factory = await nodeFfmpeg(signal, { silentRequired: true });
  signal.throwIfAborted();
  const directory = await ensureNodeDirectory(workspaceFiles, id);
  const output = `${directory}/frame.png`;
  // ACT: -update 1 让 image2 复用同一个文件名（不加会告警「不含序列模式」）；
  // -map 0:v:0 固定取首个视频流，避免带封面图（attached_pic）的素材被流选择挑错。
  const options = ["-pix_fmt", "rgb24", "-y", "-update", "1", "-map", "0:v:0"];
  try {
    const instance = factory(source).noAudio();
    const task = command === "last"
      ? instance.inputOptions("-sseof", "-1").outputOptions(...options).output(output)
      : command === "first"
        ? instance.outputOptions(...options, "-frames:v", "1").output(output)
        : instance.seekInput(currentFrameSeek()).outputOptions(...options, "-frames:v", "1").output(output);
    await runFfmpeg(task, signal);
    return output;
  } catch (error) {
    // ACT: 目录已建但取帧失败时自行回收；kill 只是发信号，子进程可能还在写，等一小会儿再删。
    await new Promise(resolve => setTimeout(resolve, 200));
    await workspaceFiles.remove(directory, true).catch(cleanupError => console.warn("截帧临时目录清理失败", cleanupError));
    throw error;
  }
}

function runFfmpeg(command: BrowserFfmpegCommand, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    function finish(error?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
    }
    // ACT: kill 只是取消握手，宿主子进程还在收尾；等 end/error 到达（或 2s 宽限）才算结束，
    // 否则调用方立刻删目录会和仍在写盘的 ffmpeg 交错。
    function stop(reason: unknown) {
      command.kill("SIGKILL");
      window.setTimeout(() => finish(reason), 2000);
    }
    function abort() { stop(signal.reason ?? new Error("截帧已取消")); }
    const timer = window.setTimeout(() => stop(new Error("视频取帧超时")), CAPTURE_TIMEOUT_MS);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    command.on("end", () => finish(signal.aborted ? signal.reason ?? new Error("截帧已取消") : undefined));
    command.on("error", (error: Error) => finish(error));
    command.run();
  });
}

/** ACT: 取产物尺寸用于节点宽度；读不到就按 1:1 处理，不影响成图。 */
async function imageSize(path: string, workspaceFiles: WorkspaceFiles, signal: AbortSignal) {
  const acquired = workspaceFiles.acquireUrl?.(path, "image/png");
  if (!acquired) return { width: 0, height: 0 };
  try {
    const url = await acquired.url;
    signal.throwIfAborted();
    return await new Promise<{ width: number; height: number }>(resolve => {
      const image = new Image();
      // ACT: 读盘/解码卡住时不能把 capturing 永远挂在 true，3s 后按 1:1 放行。
      const timer = window.setTimeout(() => resolve({ width: 0, height: 0 }), 3000);
      const done = (size: { width: number; height: number }) => { clearTimeout(timer); resolve(size); };
      image.onload = () => done({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => done({ width: 0, height: 0 });
      image.src = url;
    });
  } catch {
    return { width: 0, height: 0 };
  } finally {
    acquired.release();
  }
}

type FrameRequest = (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
type FrameCancel = (handle: number) => void;

function frameCallbacks(source: HTMLVideoElement) {
  const element = source as HTMLVideoElement & { requestVideoFrameCallback?: FrameRequest; cancelVideoFrameCallback?: FrameCancel };
  return { request: element.requestVideoFrameCallback?.bind(element), cancel: element.cancelVideoFrameCallback?.bind(element) };
}

/** ACT: 停掉常驻订阅；rVFC 是递归注册的，不显式取消会让回调一直挂在 media element 上。 */
function stopTracking() {
  const cancel = trackingSource ? frameCallbacks(trackingSource).cancel : undefined;
  if (trackingHandle !== undefined && cancel) cancel(trackingHandle);
  trackingHandle = undefined;
  trackingSource = undefined;
}

/** ACT: 持续记录「已呈现帧」的 PTS；暂停时 rVFC 仍会在 seek 后触发，所以当前帧始终有精确 PTS。 */
function trackPresentedFrame(source: HTMLVideoElement) {
  if (trackingSource === source) return;
  const { request } = frameCallbacks(source);
  if (typeof request !== "function") return;
  stopTracking();
  trackingSource = source;
  const listen = () => {
    trackingHandle = request((_now, metadata) => {
      if (trackingSource !== source) return;
      presentedMediaTime = metadata.mediaTime;
      listen();
    });
  };
  listen();
}

/** ACT: 当前帧的 seek 目标。优先用已呈现帧的 PTS（ffmpeg 的 -ss 会精确命中该帧）；
 * PTS 与播放头相差超过半秒（刚拖完进度条、回调还没追上）或拿不到时，退回播放头并回退 1ms。 */
function currentFrameSeek() {
  const current = video.value?.currentTime ?? 0;
  if (Number.isFinite(presentedMediaTime) && Math.abs(presentedMediaTime - current) <= 0.5) return Math.max(0, presentedMediaTime);
  return Math.max(0, current - FRAME_EPSILON);
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
    const signal = controller.signal;
    workspace = files.getWorkspaceFiles();
    // ACT: 海报态没有播放器元素，"当前帧"退化为首帧，明确告知而不是静默给出别的画面。
    if (command === "current" && !video.value) ElMessage.info("视频尚未播放，已截取首帧");
    // ACT: 优先让宿主用 ffmpeg 取帧。帧号按帧边界算，颜色口径与 ffmpeg/剪映一致；
    // 浏览器 canvas 解出来的像素比 ffmpeg 系恒定高约 2 个灰阶，颜色没法在 WebView 侧纠正。
    let frameWidth = 0;
    let frameHeight = 0;
    let path = "";
    const hosted = await captureOnHost(command, id, workspace, signal).catch(error => {
      if (signal.aborted) throw error;
      console.warn("宿主取帧失败，改用浏览器取帧", error);
      return "";
    });
    if (hosted) {
      const size = await imageSize(hosted, workspace, signal);
      // ACT: ffmpeg 可能 exit 0 却没写文件（seek 越过末帧），此时尺寸读不出来，按失败回退 canvas。
      if (size.width && size.height) {
        path = hosted;
        frameWidth = size.width;
        frameHeight = size.height;
        uploadStarted = true;
      } else await workspace.remove(`assets/${id}`, true).catch(() => {});
    }
    if (!path) {
      // ACT: 海报态没有 <video>，先让父层激活视频源；期间 src 变化是本次激活的结果，不能中止截帧。
      if (!src && resolveSource) {
        awaitingSource = true;
        try { await resolveSource(); }
        catch { return; } // ACT: activate 内部已提示过读取失败，这里不重复弹错。
        finally { awaitingSource = false; }
      }
      signal.throwIfAborted();
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
      const mode = command === "last" ? { kind: "last" as const } : { kind: "time" as const, time: command === "first" ? 0 : video.value?.currentTime ?? 0 };
      const target = await loadFrame(frameVideo, srcUrl, mode, signal);
      const source = frameVideo;
      signal.throwIfAborted();
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
        await nudgeFrame(source, target, signal);
      }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("截图生成失败")), "image/png"));
      signal.throwIfAborted();
      frameWidth = canvas.width;
      frameHeight = canvas.height;
      uploadStarted = true;
      path = await files.uploadFile(id, new File([blob], "frame.png", { type: "image/png" }));
    }
    signal.throwIfAborted();
    const frameLabel = { current: "当前帧", first: "首帧", last: "尾帧" }[command];
    const name = `${node.data.label || label} · ${frameLabel}`;
    if (findNode(node.id) !== node || !nodeTypes?.value?.["remote-imageNode"]) throw new Error("画布节点已变化，请重新截帧");
    const x = node.computedPosition.x + node.dimensions.width + 40;
    let y = node.computedPosition.y;
    const width = 240 * (frameWidth && frameHeight ? frameWidth / frameHeight : 1) + 18;
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
