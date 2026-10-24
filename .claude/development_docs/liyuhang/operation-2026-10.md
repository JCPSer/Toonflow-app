# 操作归档 2026-10

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-24 13:50 | 为 Toonflow 增加「运行指令」能力（服务端路由 + 画布节点）并交付可用 app | 完成，`/Applications/toonflow-exec.app` |
| 2026-10-24 14:40 | 修复 ⌘Q 无响应（菜单 Quit 项无加速键）与设置页快捷键录制不响应（WKWebView 点击 button 不聚焦） | 完成，已重打包 `/Applications/toonflow-exec.app`，旧包 `/tmp/toonflow-exec-old.app` |
| 2026-10-24 14:45 | 排查画布框选蓝色残影 | 曾误判为选区矩形/分组节点/backdrop-filter，均被实测排除 |
| 2026-10-24 16:05 | 定位根因：画布容器未禁用原生文本选择，WKWebView 对选中高亮（rgb(42,66,97)）在缩放层上重绘留残影 | 给 .canvas 加 user-select:none，其余试验改动全部回退，已重打包 |
