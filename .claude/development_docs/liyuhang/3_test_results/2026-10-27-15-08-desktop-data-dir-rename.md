# 测试结果：桌面版数据目录改名 `data` → `toonflow-data`

日期：2026-10-27 15:08

## 一、验证方式

- `bun run --filter '@toonflow/desktop' typecheck` 退出码 0。
- 迁移函数抽到独立模块 `apps/desktop/src/dataDirectory.ts`，用临时目录夹具直接测（**不碰真实的 `/Applications/data`**）。
- 桌面入口重新打包（`bun /tmp/bundle-desktop.ts` → 23,548,236 B），确认产物含新逻辑后覆盖安装包。

## 二、夹具用例（`/tmp/ddtest/test2.ts`，跑完即删）

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| 旧 `data` 存在、`toonflow-data` 不存在 | 改名；目标存在且内容一致，旧路径消失 | PASS |
| 迁移后内容一致性 | `settings.json` 内容不变、`providers/` 文件仍在 | PASS |
| 新旧目录同时存在 | 使用新目录并 warn「旧目录未合并」，不覆盖任何一方 | PASS |
| 两者都不存在（全新安装） | 返回目标路径，不创建目录（交给服务端 mkdir） | PASS |
| 旧路径是普通文件 | 不迁移，返回目标路径 | PASS |
| 旧路径是指向目录的符号链接 | 沿用重定向（返回旧路径）、不改名、不新建空目录 | PASS |
| 目标路径是符号链接 | 直接使用该链接 | PASS |
| 改名失败（父目录 chmod 555，EACCES） | 回退旧目录并输出错误日志，应用仍可用 | PASS |
| `TOONFLOW_DATA_DIR` 已设置 | 直接返回覆盖路径，不动旧目录 | PASS |
| 已完成迁移（目标已是目录） | 直接使用新目录 | PASS |
| 目标被同名文件占用 | 继续使用旧目录，不报错启动 | PASS |
| 迁移结论落盘 | 成功/占用/链接三种情况都写进 `<数据目录>/logs/desktop.log` | PASS |
| `TOONFLOW_DATA_DIR` 为相对路径 | 归一为绝对路径返回 | PASS |
| `desktop.log` 轮转 | 超过 256 KB 轮转为 `.1`（构造大文件验证） | 代码核对，未构造大文件 |

真实日志形态：

```
数据目录已迁移：/…/dd-opDbr6/data → /…/dd-opDbr6/toonflow-data
数据目录迁移失败，继续使用 /…/dd-pYg1Xo/data： EACCES: permission denied, rename … -> …/toonflow-data
旧数据目录 /…/data 与 /…/toonflow-data 同时存在，本次使用 /…/toonflow-data；旧目录未合并
数据目录 /…/data 是符号链接，按现有重定向继续使用，不做改名
```

## 三、构建与部署

- `apps/desktop` 类型检查 0；`build/desktop/main/index.js` 含 `toonflow-data` 与迁移日志文案。
- 已覆盖 `/Applications/toonflow-exec.app/Contents/Resources/app/bun/index.js`（23,548,236 B）。
- 安装器/脚本已按评审同步：`installer/initializeInstall.ts`（两边都清 `initialized`）、`installer/installer.nsi`（卸载删除 `toonflow-data`）、`scripts/deploy-local.sh`（默认新目录、回退旧目录）、`docs/development.md`、`AGENTS.md`。Windows 安装器未在本机构建，改动为静态核对。
- 部署时 `/Applications/data` 尚在、`/Applications/toonflow-data` 不存在——迁移会在**下次启动**发生，本轮未动真实数据目录。
- 类型检查、夹具、打包均在本轮最后一次源码改动之后执行（15:17 重新 typecheck → 夹具 → 打包 → 覆盖安装包），文档中的尺寸与结论对应当前工作树。

## 四、未覆盖

- 真实安装目录上的首启迁移（需要用户重启应用才会触发）。
- Windows 上的 `rename` 与 NSIS 卸载行为（本机无 Windows 环境）。
- 真正的双开竞态未实测：代码上后启动的一方 `rename` 失败后会复查目标目录，已存在就跟随（夹具用例 10 覆盖了「目标已存在」这一半）。
