import { ref } from "vue";
import { useRouter } from "vue-router";

/**
 * 退出项目确认框的共享状态。
 *
 * ACT: 顶栏退出按钮与画布 Esc 都要弹同一个确认框，而工作区同时只有一个项目。
 * 用模块级单例避免各处各写一份 v-model，也保证两处不会各弹一个。
 */
const visible = ref(false);
const leaving = ref(false);

export function requestExitProject() {
  visible.value = true;
}

export function useExitProject() {
  const router = useRouter();
  async function confirm() {
    if (leaving.value) return;
    leaving.value = true;
    try {
      await router.push("/home");
      visible.value = false;
    } finally {
      leaving.value = false;
    }
  }
  return { visible, leaving, confirm, cancel: () => { visible.value = false; } };
}
