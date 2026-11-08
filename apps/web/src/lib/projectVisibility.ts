import type { Project } from "@/stores/workspace";

/**
 * 隐藏项目的可见性判定。
 *
 * ACT: 单独成文件、不依赖平台判断与网络状态，页面各处与单元测试共用同一份规则；
 * 需要「当前是否解锁」的地方显式传入，避免各页面各写一套过滤。
 */

export function isProjectHidden(project: Project) {
  return project.hidden === true;
}

/** 单个项目在锁定态是否可见。 */
export function projectVisible(project: Project, unlocked: boolean) {
  return unlocked || !isProjectHidden(project);
}

/** 过滤掉锁定态下不该出现的项目。 */
export function filterVisibleProjects<T extends Project>(projects: T[], unlocked: boolean): T[] {
  return unlocked ? projects : projects.filter(project => !isProjectHidden(project));
}
