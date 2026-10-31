# Bug 修复方案：开启首/尾帧输出报 409

- 时间：2026-10-31 10:45
- 对应分析：`bug_analysis-2026-10-31-10-45-frame-output-rename-409.md`

## 1. 修复思路

保留「临时名 + 校验 + rename」的整体结构（它能识别 ffmpeg 静默失败与半截文件），只在 `rename` 之前**先删掉旧的目标文件**，把「不覆盖」的单向接口变成可覆盖的移动。

```
写 <name>.<uuid>.tmp.jpg  →  ffmpeg 跑完
  →  列目录确认临时文件真的存在
  →  remove(<name>)（best-effort，ENOENT 忽略）
  →  rename(tmp, <name>)
  →  失败则清理临时文件
```

放弃的替代方案：

| 方案 | 不采用的原因 |
| --- | --- |
| 直接让 ffmpeg 写目标名（`-y` 覆盖） | 失去「是否真的写盘」的判定，正是一开始引入临时名的原因 |
| 每次用唯一最终文件名 | 每次重抽都留一个孤儿文件，磁盘无限增长 |

## 2. 附带修复：错误信息透出

`describe()` 优先取 `error.response.data.message`（服务端已本地化，例如「这个名称已经被占用了」），取不到再退回 `error.message`。

## 3. 改动清单

| 文件 | 改动 |
| --- | --- |
| `packages/nodes/videoNode/src/frameOutput.ts` | `extract()` 在 rename 前 `remove(target)`；`describe()` 读取响应体 message |

## 4. 验证

| 项 | 结果 |
| --- | --- |
| 隔离服务复现 | rename 到已存在目标 = 409 EEXIST；先 remove 再 rename = 200 |
| `@toonflow/node-video` typecheck | 通过 |
| 单测 | 18 例 / 69 断言全过 |
| `build:nodes` | 通过 |
| 部署 | `videoNode.umd.js` / `videoGenerationNode.umd.js` 已同步到安装目录（未重启） |

## 5. 遗留

- 重启后需要人工复验：连续两次「关掉再开尾帧输出」都成功，且文件被覆盖而不是报错。
- 若存在第三方文件监控在 rename 前一刻重建目标文件，仍可能 409；概率极低，未加自动重试。
