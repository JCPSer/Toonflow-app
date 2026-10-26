import { inject, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { NodeMediaValue } from "./values";
import { useNodePreviewReady } from "./useNodePreviewReady";

export interface WorkspaceFiles {
  list(path?: string): Promise<{ directory: string; entries: { name: string; path: string; type: "file" | "directory" }[] }>;
  read(path: string): Promise<ArrayBuffer>;
  acquireUrl?(path: string, mimeType: string): { url: Promise<string>; release(): void };
  /** 服务端生成的缩略图地址（同源直连，同源 <img> 可直接加载），无能力时缺省。 */
  thumbUrl?(path: string, size?: number): string;
  /** 预热缩略图缓存（落盘后调用，失败静默）。 */
  warmThumb?(path: string, size?: number): void;
  readText(path: string): Promise<string>;
  readTextSnapshot(path: string): Promise<{ text: string; revision: string; encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" }>;
  writeTextSnapshot(path: string, text: string, snapshot: { revision: string; encoding: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" }): Promise<string>;
  readJson<T = unknown>(path: string): Promise<T>;
  write(path: string, content: string | Blob | ArrayBuffer, exclusive?: boolean): Promise<void>;
  writeJson(path: string, data: unknown, exclusive?: boolean): Promise<void>;
  rename(path: string, target: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  mkdir(path: string): Promise<void>;
}

function getNodeDirectory(nodeId: string) {
  if (!nodeId || /[\\/]/.test(nodeId) || nodeId === "." || nodeId === "..") throw new Error("节点 ID 不能作为文件夹名称");
  return `assets/${nodeId}`;
}

export async function uploadNodeFile(files: WorkspaceFiles, nodeId: string, file: File) {
  const directory = getNodeDirectory(nodeId);
  for (const path of ["assets", directory]) {
    await files.mkdir(path).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "EEXIST") throw error;
    });
  }
  const extension = file.name.match(/\.[a-zA-Z0-9]{1,10}$/)?.[0].toLowerCase() ?? "";
  const path = `${directory}/${crypto.randomUUID()}${extension}`;
  await files.write(path, file, true);
  return path;
}

export function useNodeFiles() {
  const createFiles = inject<(() => WorkspaceFiles) | undefined>("workspaceFiles", undefined);
  const retainNodeFiles = inject("retainNodeFiles", false);

  function getWorkspaceFiles() {
    if (!createFiles) throw new Error("当前画布未提供工作区文件能力");
    return createFiles();
  }

  function uploadFile(nodeId: string, file: File) {
    // ACT: 多步上传共用开始时的工作区，避免切换项目后写入另一目录。
    return uploadNodeFile(getWorkspaceFiles(), nodeId, file);
  }

  async function removeNodeFiles(nodeId: string) {
    const directory = getNodeDirectory(nodeId);
    // ACT: 支持撤销的画布保留节点素材，不随节点删除物理文件。
    if (retainNodeFiles) return;
    await getWorkspaceFiles().remove(directory, true).catch((error: { response?: { data?: { data?: { code?: string } } } }) => {
      if (error.response?.data?.data?.code !== "ENOENT") throw error;
    });
  }

  function useFileUrl(file: MaybeRefOrGetter<NodeMediaValue | undefined>, onError: (error: unknown) => void) {
    const fileUrl = ref("");
    const previewReady = useNodePreviewReady();
    watch([() => toValue(file), previewReady], async ([value, ready], _previous, onCleanup) => {
      let cancelled = false;
      let url = "";
      let shared: ReturnType<NonNullable<WorkspaceFiles["acquireUrl"]>> | undefined;
      onCleanup(() => {
        cancelled = true;
        shared?.release();
        if (url) URL.revokeObjectURL(url);
      });
      fileUrl.value = "";
      if (!value || !ready) return;
      try {
        const files = getWorkspaceFiles();
        shared = files.acquireUrl?.(value.url, value.mimeType);
        if (shared) {
          const sharedUrl = await shared.url;
          if (!cancelled) fileUrl.value = sharedUrl;
          return;
        }
        const content = await files.read(value.url);
        if (cancelled) return;
        fileUrl.value = url = URL.createObjectURL(new Blob([content], { type: value.mimeType }));
      } catch (error) {
        if (!cancelled) onError(error);
      }
    }, { immediate: true });
    return fileUrl;
  }

  /** 缩略图地址；节点包拿不到目录，统一经画布注入的 WorkspaceFiles 生成。 */
  function thumbUrl(path: string, size = 512) {
    return getWorkspaceFiles().thumbUrl?.(path, size) ?? "";
  }

  /**
   * 惰性媒体地址：默认只给缩略图，activate() 才真正读取 Blob，deactivate() 立即释放。
   * 用于「不播放就不把整段视频读进内存」的节点；没有 acquireUrl 能力时回退为整段读取。
   */
  function useLazyFileUrl(file: MaybeRefOrGetter<NodeMediaValue | undefined>, onError: (error: unknown) => void) {
    const url = ref("");
    const posterUrl = ref("");
    let shared: ReturnType<NonNullable<WorkspaceFiles["acquireUrl"]>> | undefined;
    let fallbackUrl = "";
    let generation = 0;

    function release() {
      generation++;
      shared?.release();
      shared = undefined;
      if (fallbackUrl) URL.revokeObjectURL(fallbackUrl);
      fallbackUrl = "";
      url.value = "";
    }

    async function activate() {
      const value = toValue(file);
      if (!value || url.value) return;
      const current = ++generation;
      try {
        const files = getWorkspaceFiles();
        if (files.acquireUrl) {
          const acquired = files.acquireUrl(value.url, value.mimeType);
          shared = acquired;
          const resolved = await acquired.url;
          if (current !== generation) { acquired.release(); shared = undefined; return; }
          url.value = resolved;
          return;
        }
        const content = await files.read(value.url);
        if (current !== generation) return;
        fallbackUrl = URL.createObjectURL(new Blob([content], { type: value.mimeType }));
        url.value = fallbackUrl;
      } catch (error) {
        if (current === generation) onError(error);
      }
    }

    watch(() => toValue(file), value => {
      release();
      posterUrl.value = value && getWorkspaceFiles().thumbUrl ? thumbUrl(value.url) : "";
    }, { immediate: true });
    onScopeDispose(release);

    return { url, posterUrl, activate, deactivate: release };
  }

  return { getWorkspaceFiles, uploadFile, removeNodeFiles, useFileUrl, useLazyFileUrl, thumbUrl };
}
