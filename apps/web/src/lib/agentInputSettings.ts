import { computed } from "vue";
import { generalSettings } from "@/stores/settings";

/**
 * 输入框层的界面开关。
 *
 * ACT: 原来寄存在「媒体生成控制」（mediaGeneration 工具配置）里，用户根本找不到入口；
 * 现在跟随「设置 → 常规」的通用设置，与画布配色等界面偏好同源，保存后立即生效。
 */
export const voiceInputEnabled = computed(() => generalSettings.value.voiceInputEnabled);
