# 操作归档 2026-10

| 时间 | 操作 | 结果 |
| --- | --- | --- |
| 2026-10-24 13:50 | 为 Toonflow 增加「运行指令」能力（服务端路由 + 画布节点）并交付可用 app | 完成，`/Applications/toonflow-exec.app` |
| 2026-10-24 14:40 | 修复 ⌘Q 无响应（菜单 Quit 项无加速键）与设置页快捷键录制不响应（WKWebView 点击 button 不聚焦） | 完成，已重打包 `/Applications/toonflow-exec.app`，旧包 `/tmp/toonflow-exec-old.app` |
| 2026-10-24 14:45 | 排查画布框选蓝色残影 | 曾误判为选区矩形/分组节点/backdrop-filter，均被实测排除 |
| 2026-10-24 16:05 | 定位根因：画布容器未禁用原生文本选择，WKWebView 对选中高亮（rgb(42,66,97)）在缩放层上重绘留残影 | 给 .canvas 加 user-select:none，其余试验改动全部回退，已重打包 |
| 2026-10-24 17:32 | 新增模型显示/隐藏开关（供应商+模型两级），重打包 app 备份 /tmp/toonflow-exec-old6.app |
| 2026-10-24 18:35 | 新增 ComfyUI 状态浮层插件（canvasOverlay 类型 + 监控代理 + 采集脚本），重打包 app 备份 /tmp/toonflow-exec-old8.app |
| 2026-10-24 20:55 | 状态栏增量：清理显存按钮 + GPU 指标标签，重打包 app 备份 /tmp/toonflow-exec-old9.app |
| 2026-10-24 21:12 | 状态栏支持整条拖动（除按钮/输入控件），重打包 |
| 2026-10-25 00:18 | 图片节点内置缩放（倍率/长边/64MP/一档恢复）与孤立节点素材自动回收 |
| 2026-10-25 00:25 | 重打包 app（备份 /tmp/toonflow-exec-old10.app），同步 nodes/ext；提交 d0aaf1e |
| 2026-10-25 00:30 | 补 TIFF ffprobe 尺寸回退、修正方案口径（中间文件/切画布），重签 app |
