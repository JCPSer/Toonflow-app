/**
 * 颜色调整：亮度、对比度、饱和度、白平衡（色温 + 色调）。
 *
 * ACT: 只在像素数组上做纯计算，不碰 DOM——预览（缩略图 canvas）与导出（全尺寸 canvas）
 * 共用同一份数学，才能保证「所见即所得」，也便于单测。
 */

export type AdjustParams = {
  /** -100 压暗 ↔ 100 提亮 */
  brightness: number;
  /** -100 平 ↔ 100 硬 */
  contrast: number;
  /** -100 去色 ↔ 100 增艳 */
  saturation: number;
  /** -100 冷（偏蓝）↔ 100 暖（偏黄） */
  temperature: number;
  /** -100 偏绿 ↔ 100 偏品红 */
  tint: number;
};

export type AdjustChannel = keyof AdjustParams;

export const defaultAdjustParams: AdjustParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
};

export const adjustChannels: { key: AdjustChannel; label: string; cold?: string; warm?: string }[] = [
  { key: "brightness", label: "亮度" },
  { key: "contrast", label: "对比度" },
  { key: "saturation", label: "饱和度" },
  { key: "temperature", label: "色温", cold: "冷", warm: "暖" },
  { key: "tint", label: "色调", cold: "绿", warm: "品红" },
];

/** 全部为 0 时没有可应用的调整。 */
export function isAdjustDefault(params: AdjustParams) {
  return adjustChannels.every(({ key }) => !params[key]);
}

function clampChannel(value: number) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

/**
 * 原地调整 RGBA 像素。
 *
 * 顺序：白平衡 → 亮度 → 对比度 → 饱和度。
 * ACT: 先做白平衡再谈明暗更接近相机流程；对比度以 128 为中心线性缩放，
 * 饱和度围绕亮度分量插值，避免过饱和时偏色。
 */
export function applyAdjustments(pixels: Uint8ClampedArray, params: AdjustParams) {
  if (isAdjustDefault(params)) return;
  const offset = params.brightness * 1.28;
  // ACT: 对比度用线性系数（0 → 全灰、2 → 两倍对比），比标准 259 公式温和；
  // 后者在 +100 会把绝大多数中间调压成纯黑/纯白，滑杆后半段等于没有梯级。
  const contrast = 1 + params.contrast / 100;
  const saturation = 1 + params.saturation / 100;
  const warm = (params.temperature / 100) * 36;
  const tint = (params.tint / 100) * 30;
  for (let index = 0; index < pixels.length; index += 4) {
    // 白平衡：色温走红/蓝对拉，色调走绿/品红对拉。
    let r = pixels[index]! + warm + tint * 0.8;
    let g = pixels[index + 1]! - tint;
    let b = pixels[index + 2]! - warm + tint * 0.8;
    r += offset;
    g += offset;
    b += offset;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    if (saturation !== 1) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * saturation;
      g = luma + (g - luma) * saturation;
      b = luma + (b - luma) * saturation;
    }
    // Uint8ClampedArray 赋值时自带 0-255 夹紧与取整。
    pixels[index] = clampChannel(r);
    pixels[index + 1] = clampChannel(g);
    pixels[index + 2] = clampChannel(b);
  }
}
