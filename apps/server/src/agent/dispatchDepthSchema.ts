import { z } from "zod";
import { UNLIMITED_DISPATCH_MAX_DEPTH } from "@/agent/runtime/dispatchLimits";

/**
 * ACT: 请求体的派发深度只做「防止异常值」的硬校验，上限取不限制档的绝对兜底值；
 * 用户配置的具体上限（1–32 或 1000）由 sendToAgent 在本次运行内判断。
 */
export const dispatchDepthSchema = z.number().int().min(0).max(UNLIMITED_DISPATCH_MAX_DEPTH).optional();
