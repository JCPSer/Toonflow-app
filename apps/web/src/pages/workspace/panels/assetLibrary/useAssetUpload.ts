import { computed, onBeforeUnmount, ref } from "vue";
import { toAssetError, uploadAsset } from "./api";
import type { AssetSelector } from "./types";
import { joinAssetPath } from "./types";

export type UploadStatus = "queued" | "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  file: File;
  name: string;
  targetPath: string;
  progress: number;
  status: UploadStatus;
  error?: string;
};

const maxBytes = 100 * 1024 * 1024;
const concurrency = 2;
const allowedExtension = /\.(avif|apng|bmp|gif|ico|jpe?g|png|svg|webp|mp4|m4v|webm|mov|mkv|avi|ogv|mp3|wav|ogg|opus|flac|m4a|aac|pdf|docx?|xlsx?|pptx?|txt|md|markdown|json|xml|csv|html|css|js|ts|ndjson)$/i;

function candidateName(name: string, index: number) {
  if (index === 0) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : "";
  return `${stem} (${index + 1})${suffix}`;
}

export type UploadSummary = { targetPath: string; added: number };

export function useAssetUpload(options: {
  selector: () => AssetSelector;
  onComplete: (uploads: UploadSummary[]) => void | Promise<void>;
}) {
  const items = ref<UploadItem[]>([]);
  const active = ref(0);
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  // ACT: 上传只新增文件、不改目录结构，汇总「目标目录 + 成功数量」供调用方做计数补丁。
  let completed = new Map<string, number>();

  const pendingCount = computed(() => items.value.filter(item => item.status === "queued" || item.status === "uploading").length);
  const hasItems = computed(() => items.value.length > 0);

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const uploads = [...completed].map(([targetPath, added]) => ({ targetPath, added }));
      completed = new Map();
      void options.onComplete(uploads);
    }, 250);
  }

  function pump() {
    while (active.value < concurrency) {
      const next = items.value.find(item => item.status === "queued");
      if (!next) return;
      void run(next);
    }
  }

  async function run(item: UploadItem) {
    item.status = "uploading";
    item.progress = 0;
    item.error = undefined;
    active.value++;
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        const path = joinAssetPath(item.targetPath, candidateName(item.name, attempt));
        try {
          await uploadAsset(options.selector(), path, item.file, (loaded, total) => {
            item.progress = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
          });
          item.progress = 100;
          item.status = "done";
          completed.set(item.targetPath, (completed.get(item.targetPath) ?? 0) + 1);
          scheduleRefresh();
          return;
        } catch (error) {
          const info = toAssetError(error);
          if (info.code === "EEXIST") continue;
          item.status = "error";
          item.error = info.message;
          return;
        }
      }
      item.status = "error";
      item.error = "同名文件过多，无法确定可用名称";
    } finally {
      active.value--;
      pump();
    }
  }

  function addFiles(files: File[], targetPath: string) {
    for (const file of files) {
      const item: UploadItem = {
        id: crypto.randomUUID(),
        file,
        name: file.name,
        targetPath,
        progress: 0,
        status: "queued",
      };
      if (file.size > maxBytes) {
        item.status = "error";
        item.error = "文件超过 100 MB 上限";
      } else if (!allowedExtension.test(file.name)) {
        item.status = "error";
        item.error = "不支持的文件类型";
      }
      items.value.push(item);
    }
    pump();
  }

  function retry(item: UploadItem) {
    if (item.status !== "error" || item.file.size > maxBytes || !allowedExtension.test(item.name)) return;
    item.status = "queued";
    item.error = undefined;
    item.progress = 0;
    pump();
  }

  function clearFinished() {
    items.value = items.value.filter(item => item.status === "queued" || item.status === "uploading" || item.status === "error");
  }

  function dismiss() {
    items.value = [];
  }

  onBeforeUnmount(() => {
    if (refreshTimer) clearTimeout(refreshTimer);
  });

  return { items, active, pendingCount, hasItems, addFiles, retry, clearFinished, dismiss };
}
