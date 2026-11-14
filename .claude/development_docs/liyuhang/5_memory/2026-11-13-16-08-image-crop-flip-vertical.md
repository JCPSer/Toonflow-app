# 记忆：图片裁剪补上上下翻转

- 时间：2026-11-13 16:08
- 类型：功能（节点 / 裁剪弹窗）

## STAR

**Situation（背景）**
裁剪弹窗只有左右镜像。翻转走的是「CSS 镜像预览 + canvas 按镜像换算源矩形重绘」两段式，加第二个轴需要把两段都扩成组合。

**Task（任务）**
补上下镜像，与左右独立可同时开；不影响裁剪框的所见即所得；两个共用该组件的节点都要跟上。

**Action（行动）**
- `imageCrop.vue`：新增 `flippedV`；预览从 `.mirrored` class 改为内联 `transform: scale(sx, sy)`（两个 class 会互相覆盖，单条 transform 可组合）；按钮拆成「左右」「上下」。
- 应用：`sourceY = mirrorY ? H - y - h : y`，再 `translate(0,h); scale(1,-1)`；两轴同时开时点映射为 `(w-x, h-y)`，等价于 180°。
- 状态：`data.crop.last` 增加 `flippedV`（旧数据缺键按 false）；`applied` 事件增加 `flippedV`；`canApply` 在整图时任一轴翻转即可应用。
- 两个消费方（imageNode / imageGenerationNode）的提示文案统一按「左右 / 上下 / 左右+上下」拼接。
- 重建两个节点 UMD，备份后同步 `/Applications/toonflow-data/nodes/` 与 `data/nodes/`。

**Result（结果）**
两个节点包 typecheck 通过（exit 0）；vite build 成功；已备份旧包并同步。需重启应用生效。

## 关键经验

1. 裁剪的镜像实现是「预览镜像 + 应用时换算源矩形」，加轴必须两处同步改；只改预览会出现「看着翻过来了、应用后又翻回去」。
2. 多个方向的镜像不要用多个 CSS class 各自 `transform`，后者会覆盖前者；用一条 `scale(sx, sy)`。
3. canvas 里连续 translate/scale 是左乘累积，两轴同时开时画布结果与 `(w-x, h-y)` 等价——可以在注释里写死这个结论，避免以后有人改成只 translate 一次。
4. 同一裁剪组件被两个节点共用（`@toonflow/node-image/imageCrop`），改事件契约时要一次改完所有消费方。
5. 评审复核确认：canvas 的 `translate/scale` 是左乘累积，两轴同时开时结果等于 `(w-x, h-y)`，与 `scale(-1,-1)` 预览一致；正确性隐含依赖 `transform-origin` 为默认中心，改 origin 必须同步改 `sourceX/sourceY`。
6. 三元表达式写「默认分支」容易埋雷：`a&&b ? "左右+上下" : a ? "左右" : "上下"` 在两者都为假时返回「上下」，改成按开启项 join 才安全。
