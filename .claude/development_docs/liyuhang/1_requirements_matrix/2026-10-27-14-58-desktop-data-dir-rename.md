# 需求矩阵：桌面版数据目录改名 `data` → `toonflow-data`

- 记录时间：2026-10-27 14:58
- 需求来源：用户提出问题「没有按应用名称做目录，直接叫 data 放在 /Applications 下面，是不是不太好？」→ 确认后收敛为「只改名字，不换目录，Windows 可以直接改」
- 代码基线：`23c190f` + 本轮未提交改动（`lib/agentLog.ts` 等，与本需求无关）

## 一、背景

桌面版把用户数据放在 `resolve(installDirectory, "data")`：

- macOS：`.app` 在 `/Applications/toonflow-exec.app`，数据落在 `/Applications/data`
- Windows：安装根目录下的 `data\`

`data` 是一个过于通用的名字，和同目录下其它软件撞名、被清理工具误删的风险高；macOS 上 `/Applications` 又是管理员可写区域，将来换账号或受管设备会出权限问题。用户明确：**不搬到 `~/Library`，只改名**，先把最刺眼的命名问题解掉。

## 二、需求矩阵

| 编号 | 需求描述 | 优先级 | 难度 | 风险 | 备注 |
| --- | --- | --- | --- | --- | --- |
| R1 | 桌面版数据目录名由 `data` 改为 `toonflow-data`，位置不变（仍在 .app / 安装根同级） | P0 | 低 | 中 | 影响所有存量用户的默认路径 |
| R2 | macOS 存量 `/Applications/data` 首次启动自动迁移，采用**原子改名**，迁移后新目录内容与旧目录一致 | P0 | 低 | 中 | 用户已从三个选项中选「原子改名」 |
| R3 | `TOONFLOW_DATA_DIR` 环境变量优先级不变；设置后完全不触发迁移 | P0 | 低 | 低 | 开发态 `dev:desktop` 依赖它 |
| R4 | 迁移失败不得让应用起不来：保留旧目录继续用，并留下可诊断日志 | P0 | 低 | 低 | 目标目录已存在、跨卷、文件被占用都要走这条路 |
| R5 | Windows 走同一套逻辑（无存量兼容包袱）；素材、供应商、配置在新目录下全部可用 | P1 | 低 | 低 | 用户原话「windows 可以直接改」 |
| R6 | 开发态与独立服务端部署（`apps/server/src/index.ts`）保持现有 `data/` 不动 | P1 | 低 | 低 | 用户已选「只改桌面安装目录」 |
| R7 | 改名不能破坏安装器/卸载器/本地部署脚本：Windows 重装同步、卸载时「同时删除用户数据」、`scripts/deploy-local.sh`、文档说明都要认新目录（并兼容旧 `data/`） | P0 | 低 | 中 | 子 agent 评审发现，原方案漏项 |
| R8 | 旧目录是符号链接（用户把 `data` 重定向到别处）时必须沿用重定向，不能改判为「不存在」而新建空目录 | P0 | 低 | 中 | 子 agent 评审发现，原方案会「数据看起来消失」 |

## 三、非目标

- 不迁移到 `~/Library/Application Support/<bundle id>`（用户明确否决）。
- 不改日志、缓存、素材库的目录结构。
- 不动 OHOS compat（`filesDir/data` 是另一套运行时约定）。
- 不处理多用户/多账号的目录权限治理（改名不改变 `/Applications` 的权限问题，只是缓解撞名）。

## 四、验收标准

1. 全新安装：首次启动直接生成 `<install>/toonflow-data`，不生成 `data`。
2. 存量安装：首次启动后旧 `data` 消失、`toonflow-data` 出现，`settings.json`、`providers/`、`nodes/` 与改名前的文件数/大小一致，界面语言、供应商、模型配置正常。
3. 设置 `TOONFLOW_DATA_DIR` 时：既不读写 `toonflow-data`，也不动旧目录。
4. 目标目录已存在时：直接使用，不覆盖、不报错。
5. 改名为不可能时（模拟失败）：应用仍能启动，且继续使用旧的 `data` 目录。

## 五、评审意见

- 子 agent 初审（2026-10-27 15:07）：主路径成立，但「只改一个入口」不成立——`apps/desktop/installer/initializeInstall.ts:34`、`installer/installer.nsi:253-257`、`scripts/deploy-local.sh:15`、`docs/development.md:281` 都硬编码了 `data`。另指出：旧目录是符号链接时会被判为「不存在」，用户数据会「凭空消失」；失败分支每次启动最多被 stubborn 重试阻塞 5 s；双开竞态下回退到已不存在的旧目录会重建空目录。以上全部采纳为 R7/R8 与分支修正。
- 用户评审：
