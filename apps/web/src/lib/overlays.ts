/**
 * ACT: Element Plus 的 el-dialog/el-drawer 用 `v-show` 收起遮罩，关闭后 `.el-overlay`
 * 依然留在 DOM 里（只是 display:none）。只数节点会把这些"常年挂着的隐藏遮罩"当成打开状态，
 * 于是快捷键门禁一直拒绝响应。判断可见性必须看计算样式，不能看查询结果数量。
 */
// ACT: 只看自身 display 不够——父级 display:none 时子元素 computed display 仍是 block，
// visibility:hidden 也会被误判；再要求真的有盒子。遮罩应 teleport 到 body，这条判断才成立。
function isVisibleOverlay(element: HTMLElement) {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

/** 当前真正可见的遮罩数量（对话框/抽屉；不含下拉浮层 .el-popper）。 */
export function visibleOverlayCount(selector = ".el-overlay") {
  return [...document.querySelectorAll<HTMLElement>(selector)].filter(isVisibleOverlay).length;
}

/** 是否有可见遮罩；语义同 visibleOverlayCount(...) > 0。 */
export function hasVisibleOverlay(selector = ".el-overlay") {
  return [...document.querySelectorAll<HTMLElement>(selector)].some(isVisibleOverlay);
}
