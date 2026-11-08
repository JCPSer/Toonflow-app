import { createRouter, createWebHashHistory } from "vue-router";
import { useHelloStore } from "@/stores/hello";
import { useWorkspaceStore } from "@/stores/workspace";
import { useProjectPrivacy } from "@/lib/projectPrivacy";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      redirect: "/hello",
    },
    {
      path: "/hello",
      beforeEnter: async () => await useHelloStore().load() ? { path: "/home", replace: true } : true,
      component: () => import("@/pages/hello/index.vue"),
    },
    {
      path: "/home",
      component: () => import("@/pages/home/index.vue"),
    },
    {
      path: "/canvas",
      redirect: "/workspace",
    },
    {
      path: "/workspace",
      component: () => import("@/pages/workspace/index.vue"),
    },
  ],
});
// ACT: 隐藏项目在锁定态不允许直达工作区。放在路由层而不是页面里，页面还没挂载就返回首页，
// 画布不会先加载一遍隐藏项目的内容；同时清掉「当前项目」，避免被 persist 带到下次启动。
router.beforeEach(to => {
  if (to.path !== "/workspace") return true;
  const workspace = useWorkspaceStore();
  const { unlocked } = useProjectPrivacy();
  if (workspace.project?.hidden && !unlocked.value) {
    workspace.project = null;
    return { path: "/home", replace: true };
  }
  return true;
});

export default router;
