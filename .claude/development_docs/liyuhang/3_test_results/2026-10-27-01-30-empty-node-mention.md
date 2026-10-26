# 测试结果：空节点可引用为「节点引用」+ 图标文字

日期：2026-10-27 01:30

## 一、验证方式

- 三包（server / web / nodeScaffold / imageNode）`tsc` / `vue-tsc --noEmit` 全部退出码 0。
- 用 bun 直接跑服务端真实模块，验证引用 schema 与 prompt 注入（`apps/server/tmp-mention-check.ts`，跑完即删，未入库）。

## 二、schema 与 prompt 实测

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| `createNodeMention` 生成的节点引用（dataType `NODE`、value `null`） | 通过 | 通过 |
| 旧会话输出引用（带 outputId/outputName） | 通过 | 通过 |
| 只给 outputId 不给 outputName | 拒绝 | 拒绝 |
| 节点引用但 dataType 写成 STRING | 拒绝 | 拒绝 |
| 输出引用但 dataType 写成 NODE | 拒绝 | 拒绝 |
| `mentionPrompt` 含节点引用 | 追加「标为 NODE 的引用是画布节点本身…」 | 命中 |
| `validateMentionTokens` 缺失 token | 抛「提及已失效」 | 抛出 |

节点引用实际产物：

```json
{"id":"d48a56e5-...","label":"空图片节点","source":{"kind":"canvas","canvasId":"proj/canvas.json","canvasName":"proj/canvas","nodeId":"n1","nodeName":"空图片节点"},"dataType":"NODE","value":null}
```

## 三、构建与部署

- `bun run build`（tools + ext + web + server）通过；`bun run build:nodes` 重新构建节点包；桌面入口重新打包（23.5 MB）。
- 已同步到 `/Applications/toonflow-exec.app`（`bun/index.js`、`views/mainview`、`nodes/*.umd.js`）与 dev 数据目录 `/tmp/tf-lib/data/nodes`。
- dev server（`bun src/index.ts`，无 watch）仍在跑旧代码，需重启后才用上新接口。

## 四、未覆盖

- 真实界面点验：空节点工具栏 `@`、`@` 菜单行尾「节点」按钮、行主体行为回归（单输出直接插输出、多输出进面板）、键盘上下键与 Enter、历史消息渲染。
- 「加入对话 / 缩放」加字后工具栏在 20vw 固定宽度内是否换行遮挡，未做视觉确认。
- 「其他画布」离线路径（`selectNode` + `storedNodeMention`）只做了类型与逻辑核对，未起第二个画布实测。

## 五、收尾

临时脚本 `apps/server/tmp-mention-check.ts` 已删除，仓库无残留调试文件。
