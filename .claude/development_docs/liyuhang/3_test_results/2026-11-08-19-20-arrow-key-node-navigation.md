# 测试结果：画布方向键选择相邻节点

- 时间：2026-11-08 19:20
- 对应方案：`../2_requirements_solutions/2026-11-08-19-20-arrow-key-node-navigation.md`
- 状态：自动化验证通过，人工验收待用户执行（应用未重启）

## 1. 单元测试

```text
bun test apps/web/src/pages/workspace/panels/canvas/nodeNavigation.test.ts
→ 18 pass / 0 fail / 30 expect

bun test apps/web/src/pages/workspace/panels/canvas
→ 54 pass / 0 fail（4 个文件，含本次 18 条）
```

覆盖点：四方向取最近、45° 边界可达、超出 45° 忽略、反向忽略、已选中/分组/隐藏/不可选排除、显式排除集合、无候选返回空、同分稳定（id 兜底）、computedPosition 优先、选区外接框起点、矩形距离优先（点在框内为 0）、空列表不崩。

## 2. 类型检查

```text
cd apps/web && bun run typecheck
→ 仅剩既有报错：../server/src/modules/agentAccess/singleAgent/types.ts(2,33) TS2307 '@/agentRuntime'
```

本次新增文件与 `canvas/index.vue` 无类型错误。

## 3. 构建

```text
bun run --filter '@toonflow/web' build
→ ✓ built in 3.42s，退出码 0
```

只改 web，不涉及节点 UMD，未重建节点包。

## 4. 人工验收清单（需重启应用后执行）

1. 点击任一节点后按 →：选中右侧最近节点，且该节点居中，缩放不变。
2. 无选中时按 ↓：视口中心附近最近的节点被选中并居中。
3. Shift+方向键连按：选区逐步扩大，视图跟随最后一个目标。
4. 多选（框选）后按裸方向键：从选区外接框出发跳一个节点，变为单选。
5. 分组背景不被选中；分组内普通节点可被选中。
6. 焦点在节点提示词输入框、设置弹窗、Agent 面板消息区时按方向键：画布选区不变。
7. 最上/最左等边缘节点朝外按方向键：无变化、无报错、无控制台异常。
8. 中文输入法组字中按方向键：不触发导航。
9. 点画布工具条按钮（如整理画布）后直接按方向键：仍能导航（焦点停在按钮上不应失效）。
10. 长按方向键：连续跳节点，动画不卡死、不抖动。

## 5. 评审发现回归验证

- P1（Agent 面板内误导航）：守卫补 `inAgentNodePanel`，代码走查通过（面板打开即聚焦根节点，`textEditing=false` 但已被拦截）。
- P1（节点内方向键控件被抢）：补 `inNodeWidget`，覆盖相机/灯光角度、裁剪、3D 场景、音频片段等节点内控件；画布工具条在节点外，验收项 9 仍成立。
- P2（画布下拉条目菜单）：补 `.el-popper / role=menu / role=listbox` 守卫。
- P3（未测量视口、连线选中、repeat 动画、exclude 测试）：均已处理，单测 18 条通过。

## 6. 部署状态

- 已构建 `build/web` 并 rsync 同步到 `/Applications/toonflow-exec.app/Contents/Resources/app/views/mainview/`（19:30，合并方式，未删除旧资源）。
- 只改 web，无节点 UMD 变更。
- **未重启应用**（按用户要求，需用户自行重启生效）。
