/**
 * JPEG 输出参数的唯一来源：首帧/尾帧、宫格输出、Agent 查看宫格共用。
 * ACT: q:v 2 约等于 95 质量；4:4:4 不降采样色度，下游当生成参考时不会出现彩边。
 */
export const JPEG_OUTPUT_OPTIONS = ["-c:v", "mjpeg", "-q:v", "2", "-pix_fmt", "yuvj444p", "-update", "1", "-y"] as const;
