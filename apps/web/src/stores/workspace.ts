import { defineStore } from "pinia";
import { ref } from "vue";
import axios from "axios";
import type { AgentAttachment } from "@/components/agent/types";

export type Project = {
  directory: string;
  name: string;
  lastOpenedAt: number;
  /** 隐藏项目：桌面端需系统验证后才在各界入口显示；标记随项目列表一起持久化。 */
  hidden?: boolean;
};

export const useWorkspaceStore = defineStore("workspace", () => {
  const project = ref<Project | null>(null);
  const projectList = ref<Project[]>([]);
  const projectLoading = ref(false);
  const projectLoadingDrawn = ref(false);
  const projectLoadingVisible = ref(false);
  const pendingAgentMessage = ref<{ directory: string; prompt: string; attachments?: AgentAttachment[]; model: string; reasoningEffort: string } | null>(null);

  async function addProject(path: string, name?: string, signal?: AbortSignal, previousDirectory = path) {
    const { data } = await axios.get<{ code: number; data?: { directory: string }; message?: string }>("/api/workspaces/check", {
      params: { directory: path }, headers: { "x-toonflow-workspace": "1" }, signal,
    });
    signal?.throwIfAborted();
    if (data.code !== 200 || !data.data?.directory) throw new Error(data.message || "工作目录校验失败");
    const checkedDirectory = data.data.directory;
    const existing = projectList.value.find(project => project.directory === previousDirectory)
      ?? projectList.value.find(project => project.directory === checkedDirectory);
    // ACT: 打开项目会重建列表项，必须把隐藏标记带过去，否则打开一次就「自动解密」了。
    const added: Project = {
      directory: checkedDirectory,
      name: name?.trim() || existing?.name || checkedDirectory.split(/[\\/]/).filter(Boolean).at(-1) || checkedDirectory,
      lastOpenedAt: Date.now(),
      ...(existing?.hidden ? { hidden: true } : {}),
    };
    projectList.value = [
      added,
      ...projectList.value.filter(item => item.directory !== previousDirectory && item.directory !== checkedDirectory),
    ];
    return added;
  }

  async function openProject(path: string, previousDirectory = path, signal?: AbortSignal) {
    project.value = await addProject(path, undefined, signal, previousDirectory);
    pendingAgentMessage.value = null;
  }

  function renameProject(path: string, name: string) {
    const target = projectList.value.find(item => item.directory === path);
    if (!target || !name.trim()) return;
    target.name = name.trim();
    if (project.value?.directory === path) project.value = target;
  }

  function removeProject(path: string) {
    projectList.value = projectList.value.filter(item => item.directory !== path);
    if (project.value?.directory === path) project.value = null;
  }

  /** 标记/取消隐藏；当前打开的项目同步更新，避免标题栏与列表状态不一致。 */
  function setProjectHidden(path: string, hidden: boolean) {
    const target = projectList.value.find(item => item.directory === path);
    // ACT: 取消隐藏时删掉字段而不是写 false，settings.json 里不会留下成片的 "hidden": false。
    if (target) {
      if (hidden) target.hidden = true;
      else delete target.hidden;
    }
    const current = project.value;
    if (current?.directory === path) {
      if (hidden) project.value = { ...current, hidden: true };
      else project.value = { ...current, hidden: undefined };
    }
  }

  return { project, projectList, projectLoading, projectLoadingDrawn, projectLoadingVisible, pendingAgentMessage, addProject, openProject, renameProject, removeProject, setProjectHidden };
}, {
  persist: {
    key: "toonflow.projectList",
    pick: ["project", "projectList"],
  },
});
