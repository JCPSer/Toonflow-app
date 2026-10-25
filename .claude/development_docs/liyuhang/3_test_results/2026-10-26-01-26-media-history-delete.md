# 测试结果：图片/视频历史记录支持删除

环境：macOS arm64 / Bun 1.3.14，dev 3121（数据目录 `/tmp/tf-lib/data`）+ vite 5173，chrome-devtools 实机操作

## 一、静态检查

| 项 | 命令 | 结果 |
| --- | --- | --- |
| videoGenerationNode 类型检查 | `bun run typecheck` | 通过 |
| imageGenerationNode 类型检查 | `bun run typecheck` | 通过 |
| 节点构建 | `bun run build:nodes` | 通过（imageGenerationNode 540.18 kB、videoGenerationNode 411.16 kB） |

## 二、运行时验证（界面真实操作）

准备：在测试项目 `libproj` 的画布中加一个视频节点，节点目录放 `v1.mp4 / v2.mp4 / v3.mp4`，`outputs.video` 指向 `v1.mp4`。

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 1 | 打开「历史记录」 | 列出 v1（当前结果）/v2/v3；底部左侧「删除」、右侧「关闭 / 设为当前结果」 | 通过 |
| 2 | 悬停列表项 | 行右侧出现红色删除图标，不压住文件名 | 通过 |
| 3 | 选中 v2 → 点底部「删除」 | 磁盘上 `v2.mp4` 消失；列表剩 v1/v3，选中自动落到 v3；节点输出不受影响 | 通过 |
| 4 | 选中 v1（当前结果）→ 删除 | 磁盘 `v1.mp4` 消失；画布 JSON 该节点 `outputs` 变为 `{}`；节点回到「暂无生成视频」空态；提取音轨/分离/截取/拉片/截帧/下载/全屏全部置灰 | 通过 |
| 5 | 只剩 v3 时点行内删除图标 | 列表切到「暂无历史记录」空态；底部「删除」「设为当前结果」均为 disabled，「关闭」可用 | 通过 |
| 6 | 删除接口直连复测 | `DELETE /api/workspaces/files/remove`（带 Origin + `x-toonflow-workspace: 1`）返回 200，文件被删除 | 通过 |

验证方式：`ls` 节点目录、读取 `画布1.json` 的 `nodes[].data.outputs`、`document.querySelector('.vue-flow__node')` 内的按钮 disabled 状态。

## 三、运行实例一致性

| 实例 | 接口 | 结果 |
| --- | --- | --- |
| dev 3121 | `GET /api/nodes/files?name=videoGenerationNode` | 含 `historyDelete`，与本地构建一致 |
| app 51950 | 同上 | 含 `historyDelete` |

说明：节点包由服务端从数据目录（`/Applications/data/nodes`、`/tmp/tf-lib/data/nodes`）读取并下发，构建后已把两个节点的 UMD 同步过去，两个实例返回的都是新包。

## 四、图片节点复测

| # | 用例 | 实际 | 结论 |
| --- | --- | --- | --- |
| 7 | 图片节点打开「图片历史记录」 | 列出 p1（当前结果）/p2，删除按钮就位 | 通过 |
| 8 | 删除当前结果 p1 | 磁盘 `p1.png` 消失；节点 `outputs` 变 `{}`；预览清空 | 通过 |

## 五、代码审查后返工复测

| # | 问题 | 修复 | 复测 |
| --- | --- | --- | --- |
| 1 | 复制/粘贴节点的历史里会列出原节点文件，误点直接删掉别人素材 | `isOwned()` 校验路径前缀 `assets/<本节点id>/`，非归属行隐藏删除能力并给出说明 | 构造当前结果指向 `assets/foreign/f1.mp4`：该行删除图标 disabled、提示「该文件属于其他节点，无法在此删除」，底部删除同样 disabled；本节点 `v1.mp4` 仍可删且只删自己 |
| 2 | footer 的 flex 样式失效（`.historyFooter` 写在 `.mediaHistory` 内，slot 是兄弟节点） | 样式提到 style 顶层 | 截图确认：删除按钮在左、关闭/设为当前结果在右 |
| 3 | 触屏无 hover，隐藏的删除按钮仍可命中 | `@media (hover: none)` 常显 | CSS 规则复查 |
| 4 | 删除非选中项会覆盖当前预览选中 | 删除前记住选中 url，仍存在则沿用 | 选中 f1（跨节点项）时删除 v1，选中仍在 f1 |
| 5 | `deleting` 未禁用「设为当前结果」「关闭」 | 两个按钮补 `deleting` | 代码复查 |
| 6 | 删除请求跨越弹窗关闭/重开 | `actionToken` 代际校验，旧请求只保留副作用 | 代码复查 |

## 六、未覆盖

- 多页（>20 条）时删除正中页的收敛：代码按 `min(index, len-1)` 选下一项并对页码取 `min(page, maxPage)`，未做大列表实测。
- 删除过程中的失败提示（`actionError`）未构造真实失败场景。
