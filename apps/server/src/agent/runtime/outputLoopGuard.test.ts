import { describe, expect, it } from "bun:test";
import {
  countUniqueGrams, isRepeatedLineLoop, LOOP_MAX_GRAM_REPEAT, LOOP_REQUIRED_HITS, MAX_BLOCK_CHARS,
  maxGramOccurrences, OutputLoopGuard,
} from "./outputLoopGuard";

function feed(guard: OutputLoopGuard, text: string, chunk = 16): string | undefined {
  for (let index = 0; index < text.length; index += chunk) {
    const reason = guard.push("1:0", text.slice(index, index + chunk));
    if (reason) return reason;
  }
  return undefined;
}

/** 生成一段每行内容都不同的正常长文，避免测试本身触发任何重复特征。 */
function variedChineseText(lines: number) {
  const words = ["晨光", "窗台", "纸页", "远处", "风声", "灯影", "山色", "墨香", "星河", "夜色", "青石", "小巷", "檐角", "竹帘", "茶烟", "云影"];
  const templates = [
    (index: number, first: string, second: string, third: string) => `第${index}段记录${first}与${second}，作者观察到${third}的变化。`,
    (index: number, first: string, second: string, third: string) => `第${index}节写到${third}靠近${first}时，${second}仍然安静。`,
    (index: number, first: string, second: string, third: string) => `第${index}条笔记把${second}放在${third}旁边，${first}留到最后。`,
    (index: number, first: string, second: string, third: string) => `第${index}页从${first}开始，随后${third}遮住${second}的轮廓。`,
  ];
  return Array.from({ length: lines }, (_, index) => templates[index % templates.length](
    index,
    words[index % words.length],
    words[(index * 7 + 3) % words.length],
    words[(index * 11 + 5) % words.length],
  )).join("\n");
}

function variedEnglishText(lines: number) {
  const words = ["camera", "lantern", "river", "window", "shadow", "paper", "distant", "silent", "amber", "folded", "narrow", "quiet", "canvas", "evening", "harbor", "silver"];
  const templates = [
    (index: number, first: string, second: string, third: string) => `Paragraph ${index} follows the ${first} past the ${second} as ${third} fades.`,
    (index: number, first: string, second: string, third: string) => `In note ${index}, the ${second} reflects ${first} while ${third} settles.`,
    (index: number, first: string, second: string, third: string) => `Line ${index} keeps ${third} near the ${first}; the ${second} remains.`,
    (index: number, first: string, second: string, third: string) => `Entry ${index} places the ${third} behind ${second}, and ${first} waits.`,
  ];
  return Array.from({ length: lines }, (_, index) => templates[index % templates.length](
    index,
    words[index % words.length],
    words[(index * 5 + 2) % words.length],
    words[(index * 9 + 7) % words.length],
  )).join("\n");
}

describe("OutputLoopGuard", () => {
  it("识别重复「写。」的思考循环", () => {
    expect(feed(new OutputLoopGuard(), "写。\n".repeat(4000))).toBe("loop");
  });

  it("识别重复英文短句", () => {
    expect(feed(new OutputLoopGuard(), "Write.\n".repeat(4000))).toBe("loop");
  });

  it("识别无换行的同一长句反复输出（8-gram 重复）", () => {
    const line = "她先往左迈出半步，画面跟着往左偏，然后坐下去，沙发皮面压出一声。";
    // 600 次足以覆盖两次检查窗；4-gram 种类多于阈值，必须靠 8-gram 命中。
    expect(feed(new OutputLoopGuard(), line.repeat(600))).toBe("loop");
  });

  it("识别 5 行 stanza 重复", () => {
    const stanza = ["山色入窗来处", "风声落案边时", "灯影摇书页后", "墨香随夜远行", "星河照未眠人"].join("\n") + "\n";
    expect(feed(new OutputLoopGuard(), stanza.repeat(200))).toBe("loop");
  });

  it("识别 20 行固定序列循环", () => {
    const cycle = Array.from({ length: 20 }, (_, index) => String.fromCharCode(0x4e00 + index)).join("\n") + "\n";
    expect(feed(new OutputLoopGuard(), cycle.repeat(300))).toBe("loop");
  });

  it("合法重复表格行只命中一次检查时不立即中止", () => {
    // 总长略超一个检查点但不足第二个检查点，模拟「短暂重复表格」而非无限循环。
    const row = "| 项目 | 数值 | 备注 |\n";
    const text = row.repeat(Math.ceil(5000 / row.length));
    expect(feed(new OutputLoopGuard(), text)).toBeUndefined();
  });

  it("合法占位 JSON 只命中一次检查时不立即中止", () => {
    const row = '{"id": null, "value": null},\n';
    const text = row.repeat(Math.ceil(5000 / row.length));
    expect(feed(new OutputLoopGuard(), text)).toBeUndefined();
  });

  it("持续重复表格行跨两次检查仍会中止（保守取舍）", () => {
    // 说明实际行为：两次检查都命中时仍会中止；这是为了避免真正的循环漏检而接受的保守阈值。
    const row = "| 项目 | 数值 | 备注 |\n";
    expect(feed(new OutputLoopGuard(), row.repeat(900))).toBe("loop");
  });

  it("正常中文长文不误判", () => {
    expect(feed(new OutputLoopGuard(), variedChineseText(500))).toBeUndefined();
  });

  it("正常英文长文不误判", () => {
    expect(feed(new OutputLoopGuard(), variedEnglishText(500))).toBeUndefined();
  });

  it("单块超过 15 万字符直接停止", () => {
    // 用足够多样的字符避开重复检测，验证硬上限本身。
    const text = Array.from({ length: MAX_BLOCK_CHARS + 1 }, (_, index) => String.fromCharCode(0x4e00 + (index % 3000))).join("");
    expect(feed(new OutputLoopGuard(), text, 4096)).toBe("too-large");
  });

  it("不同 block 独立计数", () => {
    const guard = new OutputLoopGuard();
    expect(feed(guard, "写。\n".repeat(4000))).toBe("loop");
    expect(guard.push("2:0", "正常的思考内容，包含足够多的不同词组与句式结构。")).toBeUndefined();
  });

  it("countUniqueGrams / isRepeatedLineLoop / maxGramOccurrences 边界", () => {
    expect(countUniqueGrams("写。\n".repeat(100))).toBeLessThanOrEqual(4);
    expect(isRepeatedLineLoop("短句\n".repeat(10))).toBe(false);
    expect(isRepeatedLineLoop("同一行\n".repeat(30))).toBe(true);
    expect(maxGramOccurrences("abcd".repeat(100), 4)).toBe(100);
    expect(maxGramOccurrences("abcdefgh", 8)).toBe(1);
    expect(LOOP_REQUIRED_HITS).toBe(2);
    expect(LOOP_MAX_GRAM_REPEAT).toBe(64);
  });
});
