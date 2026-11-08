import { describe, expect, test } from "bun:test";
import { settingsShortcut } from "@/components/settings/useSettingsShortcut";
import {
  canvasShortcutFields,
  defaultCanvasShortcuts,
  isShortcutAllowed,
  normalizeShortcut,
  primaryModifier,
  shortcutConflicts,
  shortcutMatches,
  shortcutPressed,
} from "./canvasShortcuts";

const none = new Set<string>();

function keys(values: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>>) {
  return { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...values };
}

describe("shortcutPressed", () => {
  test("默认修饰键严格全等：多按 Shift 不再命中 Alt", () => {
    expect(shortcutPressed(keys({ altKey: true }), "Alt", none)).toBe(true);
    expect(shortcutPressed(keys({ altKey: true, shiftKey: true }), "Alt", none)).toBe(false);
  });

  test("allowExtraShift 只放行额外的 Shift，其它修饰键仍严格", () => {
    expect(shortcutPressed(keys({ altKey: true, shiftKey: true }), "Alt", none, { allowExtraShift: true })).toBe(true);
    expect(shortcutPressed(keys({ altKey: true, ctrlKey: true }), "Alt", none, { allowExtraShift: true })).toBe(false);
  });

  test("绑定本身含 Shift 时仍然要求按住 Shift", () => {
    expect(shortcutPressed(keys({ altKey: true }), "Alt+Shift", none, { allowExtraShift: true })).toBe(false);
    expect(shortcutPressed(keys({ altKey: true, shiftKey: true }), "Alt+Shift", none, { allowExtraShift: true })).toBe(true);
  });

  test("带按键的绑定照旧校验按下的键", () => {
    expect(shortcutPressed(keys({ metaKey: true }), "Meta+KeyG", new Set(["KeyG"]))).toBe(true);
    expect(shortcutPressed(keys({ metaKey: true }), "Meta+KeyG", none)).toBe(false);
  });
});

describe("清除未读提醒快捷键", () => {
  const field = canvasShortcutFields.find(item => item.id === "clearAlerts")!;

  test("默认 Enter，可设为 None 关闭", () => {
    expect(defaultCanvasShortcuts.clearAlerts).toBe("Enter");
    expect(field.allowNone).toBe(true);
    expect(normalizeShortcut("Enter")).toBe("Enter");
    expect(isShortcutAllowed(field, "Enter")).toBe(true);
    expect(isShortcutAllowed(field, "None")).toBe(true);
  });

  test("Enter 键盘事件命中，小键盘 Enter 不误命中", () => {
    const event = { type: "keydown", key: "Enter", code: "Enter", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent;
    expect(shortcutMatches(event, "Enter")).toBe(true);
    expect(shortcutMatches({ ...event, code: "NumpadEnter" }, "Enter")).toBe(false);
  });
});

describe("shortcutConflicts", () => {
  test("普通按键动作设为 None 只是关闭，不与按住类手势的 None 冲突", () => {
    expect(shortcutConflicts("None", [{ binding: "None", hold: true }], false)).toBe(false);
    expect(shortcutConflicts("Enter", [{ binding: "None", hold: true }])).toBe(false);
  });

  test("两个按住类手势都为 None 会抢同一手势，仍算冲突", () => {
    expect(shortcutConflicts("None", [{ binding: "None", hold: true }], true)).toBe(true);
  });

  test("同一按键仍然算冲突，混合绑定只比较真实按键", () => {
    expect(shortcutConflicts("Enter", [{ binding: "Enter" }])).toBe(true);
    expect(shortcutConflicts("None / Enter", [{ binding: "Enter" }])).toBe(true);
  });
});

describe("面板入口快捷键", () => {
  test("默认 Q/W/E 且都是普通动作、可改键可关闭", () => {
    expect(defaultCanvasShortcuts.projectPicker).toBe("KeyQ");
    expect(defaultCanvasShortcuts.canvasPicker).toBe("KeyW");
    expect(defaultCanvasShortcuts.assetLibrary).toBe("KeyE");
    for (const id of ["projectPicker", "canvasPicker", "assetLibrary"] as const) {
      const field = canvasShortcutFields.find(item => item.id === id)!;
      expect(field.hold).toBeUndefined();
      expect(isShortcutAllowed(field, defaultCanvasShortcuts[id])).toBe(true);
      expect(normalizeShortcut(defaultCanvasShortcuts[id])).toBe(defaultCanvasShortcuts[id]);
      // ACT: 普通动作不走 None（那是按住类手势的语义），清空绑定即关闭。
      expect(shortcutMatches({ type: "keydown", code: "KeyQ", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent, "")).toBe(false);
    }
  });

  test("裸字母键与现有默认键不冲突", () => {
    const others = canvasShortcutFields
      .filter(field => !["projectPicker", "canvasPicker", "assetLibrary"].includes(field.id))
      .map(field => ({ binding: defaultCanvasShortcuts[field.id], hold: field.hold }));
    for (const id of ["projectPicker", "canvasPicker", "assetLibrary"] as const) {
      expect(shortcutConflicts(defaultCanvasShortcuts[id], others)).toBe(false);
    }
  });
});

describe("运行选中节点快捷键", () => {
  const base = { type: "keydown", code: "Enter", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };

  test("默认是平台主修饰键 + Enter，且和裸 Enter 的清提醒不冲突", () => {
    expect(defaultCanvasShortcuts.runNode).toBe(`${primaryModifier}+Enter`);
    const field = canvasShortcutFields.find(item => item.id === "runNode")!;
    expect(isShortcutAllowed(field, defaultCanvasShortcuts.runNode)).toBe(true);
    expect(normalizeShortcut(defaultCanvasShortcuts.runNode)).toBe(defaultCanvasShortcuts.runNode);
    const others = canvasShortcutFields.filter(item => item.id !== "runNode").map(item => ({ binding: defaultCanvasShortcuts[item.id], hold: item.hold }));
    expect(shortcutConflicts(defaultCanvasShortcuts.runNode, others)).toBe(false);
  });

  test("必须带主修饰键：裸 Enter / Shift+Enter / 多按 Alt 都不命中", () => {
    const modifier = { ctrlKey: primaryModifier === "Ctrl", metaKey: primaryModifier === "Meta" };
    expect(shortcutMatches({ ...base, ...modifier } as KeyboardEvent, defaultCanvasShortcuts.runNode)).toBe(true);
    expect(shortcutMatches(base as KeyboardEvent, defaultCanvasShortcuts.runNode)).toBe(false);
    expect(shortcutMatches({ ...base, ...modifier, shiftKey: true } as KeyboardEvent, defaultCanvasShortcuts.runNode)).toBe(false);
    expect(shortcutMatches({ ...base, ...modifier, altKey: true } as KeyboardEvent, defaultCanvasShortcuts.runNode)).toBe(false);
  });
});

describe("设置面板快捷键", () => {
  test("平台主修饰键 + Comma，单独按逗号不命中", () => {
    const base = { type: "keydown", code: "Comma", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(shortcutMatches({ ...base, ctrlKey: primaryModifier === "Ctrl", metaKey: primaryModifier === "Meta" } as KeyboardEvent, settingsShortcut)).toBe(true);
    expect(shortcutMatches(base as KeyboardEvent, settingsShortcut)).toBe(false);
    expect(shortcutMatches({ ...base, ctrlKey: primaryModifier === "Ctrl", metaKey: primaryModifier === "Meta", shiftKey: true } as KeyboardEvent, settingsShortcut)).toBe(false);
  });
});
