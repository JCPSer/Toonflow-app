const isMac = globalThis.navigator?.platform?.includes("Mac") ?? false;
export const primaryModifier = isMac ? "Meta" : "Ctrl";
const modifiers = ["Ctrl", "Alt", "Shift", "Meta"];

export const defaultCanvasShortcuts = {
  group: `${primaryModifier}+KeyG / Alt+KeyG`,
  mergeGroup: isMac ? "Alt+Meta+KeyG" : "Ctrl+Alt+KeyG",
  ungroup: isMac ? "Shift+Meta+KeyG / Alt+Shift+KeyG" : "Ctrl+Shift+KeyG / Alt+Shift+KeyG",
  addNode: "Tab",
  copyOnDrag: "Alt",
  duplicateOnDrag: isMac ? "Alt+Meta" : "Ctrl+Alt",
  pan: "Space",
  zoom: "Ctrl",
  selection: "None",
  multiSelection: "",
  moveTool: "KeyV",
  handTool: "KeyH",
  arrange: "Alt+Shift+KeyF",
  search: `${primaryModifier}+KeyF`,
  // ACT: 三个面板入口用裸字母键：现有字母键只有 V/H（工具），Q/W/E 全空；带修饰键的组合容易和系统/浏览器抢。
  projectPicker: "KeyQ",
  canvasPicker: "KeyW",
  assetLibrary: "KeyE",
  delete: "Backspace",
  clearAlerts: "Enter",
  // ACT: ⌘Enter 跑选中节点。注意与 clearAlerts 的裸 Enter 不冲突：匹配是修饰键严格全等的。
  runNode: `${primaryModifier}+Enter`,
  copy: `${primaryModifier}+KeyC`,
  cut: `${primaryModifier}+KeyX`,
  paste: `${primaryModifier}+KeyV`,
  undo: `${primaryModifier}+KeyZ`,
  redo: isMac ? "Shift+Meta+KeyZ" : "Ctrl+Shift+KeyZ",
  toggleDisabled: `${primaryModifier}+Shift+KeyD`,
  // ACT: 连线显隐是纯视觉开关，工具条已有按钮；裸字母键 L 当前未被占用（V/H 工具、Q/W/E 面板），排在工具键旁边。
  toggleEdges: "KeyL",
  // ACT: 空格默认同时是「按住平移」。两者靠手势区分：轻点（未拖动）预览，按住/拖动才平移。
  preview: "Space",
  zoomIn: isMac ? "Meta+Equal / Shift+Meta+Equal" : "Ctrl+Equal / Ctrl+Shift+Equal",
  zoomOut: `${primaryModifier}+Minus`,
  fitView: `${primaryModifier}+Digit0`,
};
export type CanvasShortcutAction = keyof typeof defaultCanvasShortcuts;

/**
 * ACT: 允许共用同一按键的动作对。空格既是「按住平移」又是「轻点预览」，两者靠手势区分，
 * 所以彼此的重复不算冲突；其余动作之间仍按原规则严格校验。
 */
const sharedKeyPairs: Partial<Record<CanvasShortcutAction, CanvasShortcutAction>> = {
  preview: "pan",
  pan: "preview",
};

/** 两个动作是否可以共用同一个按键绑定（当前只有预览 ↔ 平移）。 */
export function shortcutsMayShareBinding(action: CanvasShortcutAction, other: CanvasShortcutAction) {
  return sharedKeyPairs[action] === other;
}
export type CanvasShortcuts = Record<CanvasShortcutAction, string>;

export const canvasShortcutFields: {
  id: CanvasShortcutAction;
  label: string;
  hold?: boolean;
  allowNone?: boolean;
  gesture?: "drag" | "wheel" | "click";
}[] = [
  { id: "group", label: "成组" },
  { id: "mergeGroup", label: "合并分组" },
  { id: "ungroup", label: "解组" },
  { id: "addNode", label: "新建节点" },
  { id: "copyOnDrag", label: "节点复制", hold: true, gesture: "drag" },
  { id: "duplicateOnDrag", label: "创建副本", hold: true, gesture: "drag" },
  { id: "zoomIn", label: "放大" },
  { id: "zoomOut", label: "缩小" },
  { id: "fitView", label: "适应画布" },
  { id: "zoom", label: "滚轮缩放", hold: true, gesture: "wheel", allowNone: true },
  { id: "pan", label: "画布平移", hold: true, allowNone: true },
  { id: "selection", label: "框选节点", hold: true, allowNone: true },
  { id: "multiSelection", label: "追加选择", hold: true, gesture: "click" },
  { id: "moveTool", label: "移动" },
  { id: "handTool", label: "抓手工具" },
  { id: "arrange", label: "整理画布" },
  { id: "undo", label: "撤销" },
  { id: "redo", label: "重做" },
  { id: "toggleDisabled", label: "禁用/解除禁用节点" },
  { id: "toggleEdges", label: "显示/隐藏连线" },
  { id: "search", label: "画布节点搜索" },
  { id: "preview", label: "预览选中节点", allowNone: true },
  { id: "projectPicker", label: "项目下拉" },
  { id: "canvasPicker", label: "画布下拉" },
  { id: "assetLibrary", label: "素材库面板" },
  { id: "delete", label: "删除" },
  { id: "clearAlerts", label: "清除未读提醒", allowNone: true },
  { id: "runNode", label: "运行选中节点" },
  { id: "copy", label: "复制到剪贴板" },
  { id: "cut", label: "剪切到剪贴板" },
  { id: "paste", label: "粘贴" },
];

const keyLabels: Record<string, string> = {
  None: "无需按键",
  Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: isMac ? "⌘" : "Win",
  Space: "Space", Escape: "Esc", Enter: "Enter", Tab: "Tab", Backspace: "⌫", Delete: "Delete",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
  Minus: "−", Equal: "+", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
  CapsLock: "CapsLock", NumLock: "NumLock", ScrollLock: "ScrollLock", Pause: "Pause", PrintScreen: "PrintScreen",
  NumpadAdd: "小键盘 +", NumpadSubtract: "小键盘 -", NumpadMultiply: "小键盘 *", NumpadDivide: "小键盘 /",
  NumpadDecimal: "小键盘 .", NumpadEnter: "小键盘 Enter", NumpadEqual: "小键盘 =",
};

export function normalizeShortcut(value: string): string | undefined {
  if (!value.trim()) return "";
  const bindings = value.split("/").map(normalizeBinding);
  if (bindings.some(binding => binding === undefined)) return;
  return [...new Set(bindings)].join(" / ");
}

function normalizeBinding(value: string): string | undefined {
  if (value.trim() === "None") return "None";
  const parts = value.split("+").map(part => part.trim());
  if (parts.includes("None")) return;
  if (new Set(parts).size !== parts.length) return;
  const keys = parts.filter(part => !modifiers.includes(part));
  if (keys.length > 1 || keys.some(key => !Object.hasOwn(keyLabels, key) && !/^(?:Key[A-Z]|Digit\d|Numpad\d|F(?:[1-9]|1\d|2[0-4]))$/.test(key))) return;
  return [...modifiers.filter(modifier => parts.includes(modifier)), ...keys].join("+");
}

export function getShortcutBindings(binding: string) {
  return binding.split("/").map(value => value.trim()).filter(Boolean);
}

export function isModifierShortcut(binding: string) {
  return !!binding && binding.split("+").every(part => modifiers.includes(part));
}

export function isShortcutAllowed(field: typeof canvasShortcutFields[number], binding: string) {
  return getShortcutBindings(binding).every(value => value === "None" ? field.allowNone === true : field.gesture === "drag" || field.gesture === "click"
    ? isModifierShortcut(value) : field.hold || !isModifierShortcut(value));
}

export function shortcutFromEvent(event: KeyboardEvent) {
  const modifier = ["Control", "Alt", "Shift", "Meta"].includes(event.key);
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", !modifier && event.code]
    .filter(Boolean).join("+");
}

/**
 * ACT: 「None」在按住类手势里表示「无需按键、始终生效」（如框选/平移），两个按住类动作都为 None
 * 会抢同一个鼠标手势，仍算冲突；对普通按键动作（如清除未读提醒）None 表示「关闭」，不参与冲突。
 */
export function shortcutConflicts(binding: string, others: Iterable<{ binding: string; hold?: boolean }>, hold = false) {
  const own = getShortcutBindings(binding);
  for (const other of others) {
    const theirs = getShortcutBindings(other.binding);
    for (const value of own) {
      if (!theirs.includes(value)) continue;
      if (value !== "None" || (hold && other.hold === true)) return true;
    }
  }
  return false;
}

export function shortcutMatches(event: KeyboardEvent, binding: string) {
  return !!binding && event.type !== "keyup" && getShortcutBindings(binding).includes(shortcutFromEvent(event));
}

export function shortcutPressed(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  binding: string,
  pressedCodes: ReadonlySet<string>,
  options: { allowExtraShift?: boolean } = {},
) {
  return getShortcutBindings(binding).some(value => {
    if (value === "None") return true;
    const parts = value.split("+");
    // ACT: Shift 固定留给画布轴锁，拖动手势按「忽略额外 Shift」匹配——Shift+Alt 仍然算 Alt 复制。
    // 其余修饰键保持严格全等，避免 Ctrl/⌘ 之类误命中。
    const shiftMatches = parts.includes("Shift")
      ? event.shiftKey
      : event.shiftKey === false || options.allowExtraShift === true;
    if (event.ctrlKey !== parts.includes("Ctrl") || event.altKey !== parts.includes("Alt")
      || !shiftMatches || event.metaKey !== parts.includes("Meta")) return false;
    const key = parts.find(part => !modifiers.includes(part));
    return !key || pressedCodes.has(key);
  });
}

export function shortcutLabel(binding: string) {
  return getShortcutBindings(binding).map(value => value.split("+")
    .map(part => keyLabels[part] ?? part.replace(/^(?:Key|Digit)/, "").replace(/^Numpad/, "小键盘 ")).join(" + ")).join(" / ");
}
