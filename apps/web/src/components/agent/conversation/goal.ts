/**
 * /goal 指令模式的状态与提示词。
 *
 * ACT: 只做客户端驱动的"轮次结束后自评 + 自动续跑"，判定由模型自己在回复末尾输出标记完成，
 * 因此状态需要落到项目里：打断/关面板/重启后重新打开对话能接着跑。
 */
export type GoalStatus = "active" | "paused" | "done";

export type GoalState = {
  goal: string;
  round: number;
  maxRounds: number;
  status: GoalStatus;
  updatedAt: string;
};

export const GOAL_DONE_MARK = "[[GOAL:DONE]]";
export const defaultMaxRounds = 10;

/** 目标文件按会话存放，与 .agent/sessions 同目录层级，便于随项目一起迁移。 */
export function goalPath(sessionFile: string) {
  return `.agent/goals/${sessionFile}.json`;
}

export function donePattern() {
  // ACT: 模型可能把标记写进代码块或加粗，宽松匹配，不要求严格逐字符。
  return /(\[\[\s*GOAL\s*:\s*DONE\s*\]\])|【\s*GOAL\s*[:：]\s*DONE\s*】/i;
}

export function stripDoneMark(text: string) {
  return text.replace(/(\[\[\s*GOAL\s*:\s*DONE\s*\]\])|【\s*GOAL\s*[:：]\s*DONE\s*】/gi, "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function goalReviewPrompt(state: GoalState) {
  return [
    `/goal 自动回顾（第 ${state.round}/${state.maxRounds} 轮）`,
    `当前目标：${state.goal}`,
    "请先核对目标是否已经达成，再决定下一步：",
    "1. 已达成：用一两句话确认结论，并在回复的最后单独一行输出 " + GOAL_DONE_MARK + "，不要继续调用工具。",
    "2. 未达成：说明还缺什么，然后直接继续执行达成目标所需的下一个动作，不要把工作留到下一轮。",
    "不要复述这条指令，也不要向用户提问确认，除非确实缺少只有用户能提供的信息。",
  ].join("\n");
}
