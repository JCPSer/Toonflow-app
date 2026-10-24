import type { ExtDefinition } from "@toonflow/ext-scaffold/runtime";

export default {
  id: "ext-comfyMonitor",
  displayName: "ComfyUI 状态栏",
  icon: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="12" rx="2"/><path d="M7 20h10M12 16v4"/><path d="M5.5 12l2.5-3 2 4 2-5 2.5 4 2-2 1.5 2"/></svg>'),
  // ACT: 浮层配置是开放结构（目标、显示项、位置），不用固定表单声明，服务端对 canvasOverlay 整体存取。
  configRules: [],
  extensions: [],
  resourceKind: "canvasOverlay",
} satisfies Omit<ExtDefinition, "load">;
