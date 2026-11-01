import { ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { countRunningNodes } from "@/lib/runningNodes";

/**
 * 退出项目确认框的共享状态。
 *
 * ACT: 顶栏退出按钮与画布 Esc 都要弹同一个确认框，而工作区同时只有一个项目。
 * 用模块级单例避免各处各写一份 v-model，也保证两处不会各弹一个。
 */
const visible = ref(false);
const leaving = ref(false);
/** 打开确认框那一刻的运行中节点数；0 表示维持原来的「是否退出」文案。 */
const runningCount = ref(0);

export function requestExitProject() {
  // ACT: 只读一次快照——弹窗停留期间节点跑完/新开都不再刷新文案，避免用户读到的数字变来变去。
  runningCount.value = countRunningNodes();
  visible.value = true;
}

export function useExitProject() {
  const router = useRouter();
  async function confirm() {
    if (leaving.value) return;
    leaving.value = true;
    // ACT: 先收起退出框再导航：路由守卫可能弹出「项目未保存」确认，留在原地会和它叠成两层弹窗。
    visible.value = false;
    try {
      await router.push("/home");
    } catch (error) {
      // ACT: 弹窗已经收起，异常必须给回音，否则用户只会看到「点了没反应」。
      ElMessage.error(error instanceof Error ? error.message : "退出项目失败");
    } finally {
      leaving.value = false;
    }
  }
  return { visible, leaving, runningCount, confirm, cancel: () => { visible.value = false; } };
}
