# 测试结果：文本节点输入区隐显 + 画布渲染成本

日期：2026-10-26 17:30
环境：dev（vite :5173 + bun :3121），复制的真实画布（26 节点 / 21 连线 / 3 个视频节点 / 6 个文本节点），Chrome DevTools 实测

## 一、文本节点输入区

- 取消选中前：`promptCard` 存在。
- 点选节点：`promptCard` 出现。
- 点画布空白（pointerdown → pointerup → click，走真实事件序列）：节点 `selected` 变 false，`promptCard` 消失。
- 与 video/image 节点行为一致。

## 二、帧率测量

| 场景 | avg | max |
| --- | --- | --- |
| 基线（26 节点、3 视频元素、无动画） | 16.7 ms | 17.6 ms |
| 强制 21 条连线动画 + 浮层毛玻璃 | 18.3 ms | 266.7 ms |
| 上一条移除全部 backdrop-filter | 18.0 ms | 133.8 ms |
| 单视频播放 | 16.7 ms | 17.7 ms |
| 拖动节点 60 帧 | 16.9 ms | 33.9 ms |

结论：连线动画是长帧主要来源（267 ms → 17 ms）；毛玻璃次之（长帧减半）。两者按用户要求保留，改为消除「停靠面板的无效模糊」。

## 三、停靠面板模糊

- 修复前：`.floatingAssetLibrary.docked` 计算样式 `backdrop-filter: blur(6px)`。
- 修复后：`none`；`floatingAgent`（未停靠）仍为 `blur(6px)`。

## 四、长文预览

- `.textPreview` 仍为 `max-height: 240px; overflow: auto`，新增 `content-visibility: auto; contain-intrinsic-size: auto 120px` 到子元素。
- 滚动与展开在 dev 画布上目测正常；长文节点内容完整（DOM 未截断）。

## 五、构建与检查

- `vue-tsc` 通过；`bun run build:nodes` 通过；`bun run build`（web）通过。
- `textNode.umd.js` 已同步到 dev 数据目录与 app；桌面入口重打包安装。

## 五之二、应用内 30 帧的定位过程

1. 最小 WKWebView（空页面、带持续动画）：rAF 31 帧；CVDisplayLink 实测 60 次/秒。
2. Safari 打开本地帧率页：30 帧；同机 Chromium（dev）60 帧。
3. 关闭 macOS 低电量模式后：`pmset` `powermode` 由 1 回 0，WKWebView 复测 61 帧。
4. 结论：低电量模式限制 WebKit 渲染帧率，非应用问题。曾据此加入的自动降级功能已按要求整体移除，并重新构建安装。

## 六、未覆盖

1. 打包应用（WKWebView）内的真实帧率与冻结复现：需用户在应用内查看开发者选项的「当前 N 帧」或在卡死时记录本机内存。
2. `preload=auto` 改为 metadata、视频 Blob 改同源 Range URL 两项未实施（见方案「不做 / 待办」）。
