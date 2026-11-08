import { ref } from "vue";

import { probeSystemAuthentication, verifySystemIdentity } from "@/lib/desktopAuth";
import { filterVisibleProjects as filterVisible, isProjectHidden, projectVisible as projectVisibleWith } from "@/lib/projectVisibility";
import { isDesktop, isRemoteConnection } from "@/lib/platform";
import type { Project } from "@/stores/workspace";

export { isProjectHidden };

/**
 * 隐藏项目的解锁状态。
 *
 * ACT: 解锁只在当前进程内存里有效——不写 settings、不进 localStorage，应用重启必然回到锁定态，
 * 演示前重启一次就是干净状态。
 * ACT: 浏览器/手机远程没有 Touch ID，按需求默认视为可看（isDesktop=false 时初始即解锁）。
 */
const unlocked = ref(!isDesktop || isRemoteConnection);
/** 验证进行中，避免重复弹窗和重复轮询。 */
const verifying = ref(false);
/** 当前验证请求；锁定/离开时中断轮询，不让它空转 4 分钟。 */
let authController: AbortController | null = null;
/**
 * 当前安装包能否做系统验证。null = 尚未探测。
 * ACT: 远端桌面连接（desktop=1&remote=1）没有本机 /api/desktop 通道，不能当作可验证。
 */
const authSupported = ref<boolean | null>(null);
export const authCapable = isDesktop && !isRemoteConnection;

/** 探测一次本机验证能力，失败按不支持处理（宁可不给隐藏，也不能让人藏了打不开）。 */
export async function refreshAuthSupport(): Promise<boolean> {
  if (!authCapable) {
    authSupported.value = false;
    return false;
  }
  if (authSupported.value !== null) return authSupported.value;
  authSupported.value = await probeSystemAuthentication();
  return authSupported.value;
}

export function usesNativeAuth() {
  return authCapable;
}

const authMessages: Record<string, string> = {
  cancelled: "已取消验证，隐藏项目保持锁定",
  unavailable: "当前环境不支持系统验证，隐藏项目保持锁定",
  notInteractive: "系统验证窗口无法显示，请回到 Toonflow 后再试",
  failed: "验证未通过，隐藏项目保持锁定",
  error: "验证失败，请重试",
};

export interface UnlockResult {
  ok: boolean;
  message?: string;
}

/** 解锁隐藏项目；桌面端走系统验证，非桌面直接放行（远程照常显示）。 */
export async function unlockHiddenProjects(reason = "验证以显示隐藏项目"): Promise<UnlockResult> {
  if (unlocked.value) return { ok: true };
  if (!isDesktop) {
    unlocked.value = true;
    return { ok: true };
  }
  if (verifying.value) return { ok: false, message: "正在验证，请稍候" };
  verifying.value = true;
  const controller = new AbortController();
  authController = controller;
  try {
    const result = await verifySystemIdentity(reason, controller.signal);
    if (result.ok) {
      unlocked.value = true;
      return { ok: true };
    }
    return { ok: false, message: result.message ?? authMessages[result.code] ?? authMessages.error };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, message: "验证已取消" };
    return { ok: false, message: error instanceof Error && error.message ? error.message : authMessages.error };
  } finally {
    if (authController === controller) authController = null;
    verifying.value = false;
  }
}

/** 立即锁定：首页跳回「项目」页由调用方负责。 */
export function lockHiddenProjects() {
  unlocked.value = false;
  // ACT: 锁定即放弃正在等待的验证；否则用户关掉开关后前端还在轮询。
  authController?.abort();
  authController = null;
}

/** 单个项目在当前会话是否可见。 */
export function projectVisible(project: Project, unlockedValue = unlocked.value) {
  return projectVisibleWith(project, unlockedValue);
}

/** 过滤掉锁定态下不该出现的项目；各处入口统一走这里，避免漏掉某条列表。 */
export function filterVisibleProjects<T extends Project>(projects: T[], unlockedValue = unlocked.value): T[] {
  return filterVisible(projects, unlockedValue);
}

export function useProjectPrivacy() {
  return { unlocked, verifying, authSupported, unlockHiddenProjects, lockHiddenProjects };
}
