# 记忆：桌面版数据目录改名 `data` → `toonflow-data`（含存量迁移）

## Situation

桌面版把用户数据放在 `<install>/data`：macOS 是 `/Applications/data`（与 .app 同级），Windows 是安装根目录下 `data\`。`data` 过于通用，会和同目录其它软件撞名、被清理工具误删，`/Applications` 又是管理员可写区域。用户明确只改名、不搬目录。

## Task

把桌面端数据目录改名为 `toonflow-data`，位置不变；存量安装首次启动原子改名迁移；`TOONFLOW_DATA_DIR` 优先；迁移失败必须继续用旧目录而不是让应用起不来；开发态与独立服务端仍用 `data/`。

## Action

- 新增 `apps/desktop/src/dataDirectory.ts`：`inspect()`（只把 ENOENT 当不存在，其余错误显式暴露）+ `resolveDesktopDataDirectory()`。分支：环境变量直通 → 目标已是目录直接用（旧目录共存时 warn）→ 旧目录不是目录则返回目标 → 旧目录是符号链接则尊重重定向 → 否则 `rename` 原子改名，失败时复查目标（双开竞态）再回退旧目录。
- `apps/desktop/src/index.ts`：改为 `await resolveDesktopDataDirectory(installDirectory)`，并在调用点再包一层 catch 回退旧目录，保证 `start()` 不会因迁移抛错（macOS 上会闪退）。
- 评审发现的硬编码位置一并修正：`installer/initializeInstall.ts`（`toonflow-data` 与 `data` 两边都清 `initialized`，否则旧版本机器升级重装漏同步内置插件）、`installer/installer.nsi`（卸载勾选「同时删除用户数据」时也删 `toonflow-data`，否则 `RMDir $INSTDIR` 失败退出码 2）、`scripts/deploy-local.sh`（默认新目录，回退旧目录）、`docs/development.md`、`AGENTS.md`。
- 代码审查补充：迁移结论写入 `<数据目录>/logs/desktop.log`（打包版没有终端，console 不可见）；目标被同名文件占用时继续用旧目录；常量改为小驼峰以符合 AGENTS 规则 5。
- 未改 `apps/server/src/index.ts`：桌面端通过 `createApp({ dataDirectory })` 覆盖，开发与独立部署保持 `data/`。

## Result

`apps/desktop` 类型检查 0；迁移函数用 14 个临时目录夹具验证（改名、内容一致、新旧共存、全新安装、旧是文件、旧是符号链接、目标是符号链接、EACCES 回退、环境变量优先、已完成迁移）全部 PASS；桌面入口打包 23,548,236 B 并覆盖安装包。真实迁移会在用户下次启动时发生，旧目录按原子改名整体消失（回滚=改回 `data`，旧版本只认这个名字）。
