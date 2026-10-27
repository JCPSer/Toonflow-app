# 需求方案：桌面版数据目录改名 `data` → `toonflow-data`

- 记录时间：2026-10-27 15:05
- 对应需求：`1_requirements_matrix/2026-10-27-14-58-desktop-data-dir-rename.md`
- 决策：只改桌面安装目录；原子改名迁移；`TOONFLOW_DATA_DIR` 优先；失败回退到旧目录

## 一、现状

`apps/desktop/src/index.ts` 里只有一处推导数据目录：

```
installDirectory = Resources + (darwin ? "../../.." : "../..")
dataDirectory    = TOONFLOW_DATA_DIR ?? installDirectory/data
```

其后所有读写（`settings.json`、窗口状态、传给 `createApp` 的 `dataDirectory`）都基于这个值；`apps/server/src/index.ts` 只在独立运行时自己推导 `data/`，桌面端会通过 `createApp({ dataDirectory })` 覆盖，因此**桌面端只需改这一个入口**。

## 二、设计

### 2.1 新增常量与解析函数

在 `apps/desktop/src/index.ts` 模块级新增：

```
DATA_DIRECTORY_NAME = "toonflow-data"
LEGACY_DATA_DIRECTORY_NAME = "data"

async resolveDesktopDataDirectory(installDirectory):
    overlay = process.env.TOONFLOW_DATA_DIR
    if overlay 非空 → 直接返回 overlay                 // R3：完全不碰迁移
    target = installDirectory/ DATA_DIRECTORY_NAME
    legacy = installDirectory/ LEGACY_DATA_DIRECTORY_NAME
    if 目标是目录 → 返回 target                        // R4：已有新目录，不覆盖
    if 旧目录不是目录 → 返回 target                    // 全新安装
    try
        rename(legacy, target)                        // R2：原子改名，同卷瞬时
        记录 info 日志（含旧、新路径）
        return target
    catch error
        console.error("数据目录迁移失败，继续使用旧目录：", error)
        return legacy                                 // R4：宁可不变也不能起不来
```

要点：

- 用 `@toonflow/file` 的 `rename`（带 stubborn 重试），失败直接回退，不做多 GB 的递归复制（用户已选原子改名）。
- 判空用 `lstat` 而非 `existsSync`：符号链接或文件占位时不误判，走「返回 target」由服务端自行 mkdir。
- 迁移失败返回 legacy 而不是 target：避免「新目录空着、用户以为配置丢了」。
- 不改 `apps/server/src/index.ts`（R6）。

### 2.2 调用点

`try {` 块开头改为先 `const installDirectory = …`，再 `const dataDirectory = await resolveDesktopDataDirectory(installDirectory);`，其余逻辑不变（读取 `settings.json`、设置语言回退、`createApp` 传参、`windowState.json` 路径都复用同一个 `dataDirectory`）。

### 2.3 兼容性

| 场景 | 行为 |
| --- | --- |
| 存量 macOS 用户（`/Applications/data`） | 首次启动改名为 `/Applications/toonflow-data`，旧名消失 |
| 存量 Windows 用户（`<install>\data`） | 同上，同一套逻辑 |
| `TOONFLOW_DATA_DIR` 已设置（dev / 便携部署） | 完全不走迁移分支 |
| 全新安装 | 旧目录不存在 → 直接用 `toonflow-data`（由服务端 mkdir） |
| 已迁移过一次 | 目标存在 → 直接使用，旧目录自然不存在 |
| 改名失败（跨卷/占用/权限） | 继续使用旧目录并记录错误日志，功能不受影响 |

### 2.4 回滚

**必须手动把 `toonflow-data` 改回 `data`**，旧版本才会读到数据。改名本身是原子的、内容未变，所以回滚只涉及目录名。注意：如果直接部署旧版本而不改名，旧版本会在旧路径上新建一个空 `data`，看起来像配置全丢——旧版本不认识 `toonflow-data`。

### 2.5 评审补充：改名会漏掉的硬编码位置（已一并修改）

| 文件 | 原内容 | 处置 |
| --- | --- | --- |
| `apps/desktop/installer/initializeInstall.ts:34` | 只清 `<install>/data/<dir>/initialized` | 同时清 `toonflow-data` 与 `data`：旧版本机器上升级重装时目录还叫 `data`，只认新名会漏同步内置节点/工具/供应商 |
| `apps/desktop/installer/installer.nsi:252-257` | 勾选「同时删除用户数据」只删 `$INSTDIR\data` | 增加 `RMDir /r "$INSTDIR\toonflow-data"`；否则卸载后 `RMDir "$INSTDIR"` 失败、退出码 2 |
| `scripts/deploy-local.sh:15` | `DATA=/Applications/data` | 默认优先 `toonflow-data`，不存在再退回 `data` |
| `docs/development.md:281` | 「保留 `data/`」 | 改为 `toonflow-data/`（旧安装为 `data/`），并写明卸载勾选会一并清理 |
| `AGENTS.md:203` | 「生产环境使用安装目录下的 `data/`」 | 改为桌面端 `toonflow-data/`，仓库 `data/` 仅用于开发与独立部署 |

### 2.6 评审补充：符号链接与错误语义

- 旧 `data` 是**指向目录的符号链接**：视为用户有意重定向，返回该链接、不改名，记录 warn。原实现按「不是目录」处理会新建空目录，用户会以为数据丢了。
- 目标 `toonflow-data` 是符号链接：直接使用，不再尝试 rename（否则每次启动都会失败重试）。
- `lstat` 只把 `ENOENT` 当「不存在」，其余错误记录并保持旧目录，避免静默新建空目录。
- 新旧目录同时存在：使用新目录并 warn 提示旧目录未合并。
- 改名失败时先复查目标是否已被另一实例建好，再回退旧目录（双开竞态）。
- 调用点再包一层 catch，保证任何意外都回退到旧目录而不是让 `start()` 抛出（macOS 上会表现为闪退）。

### 2.7 需要同步的文档

仓库 README / docs 中若出现「数据在安装目录 data/」的说明，一并改成 `toonflow-data`；找不到就不改。

## 三、测试方案

1. `apps/desktop` 类型检查（`bun apps/desktop/scripts/build.ts typecheck`）。
2. 用临时夹具跑迁移函数（不碰真实 `/Applications/data`）：
   - 旧存在 / 目标不存在 → 目标出现、旧消失、文件数一致；
   - 目标已存在 → 不动作；
   - 旧不存在 → 返回目标；
   - 迁移失败（把旧目录设成不可写/构造 rename 失败）→ 返回旧目录。
3. 打包桌面入口后**不自动启动**，等用户下次启动实机验证（迁移会在那一刻发生）。
4. 实测（用户侧）：启动后确认 `toonflow-data` 存在、`data` 消失、供应商与语言设置正常。

## 四、风险

| 风险 | 处置 |
| --- | --- |
| 改名瞬间失败导致数据不可见 | 失败即回退旧目录，不改名也能正常用；rename 原子且内容不变，可手动改回 |
| 与更新器冲突（更新替换安装目录） | 数据目录不在 `.app`/安装包内部（macOS 在 .app 同级，Windows 在安装根），更新器只替换程序资源 |
| Windows 卸载器不认识新目录 | 结果是卸载后数据保留（更安全），如需清理由用户手动删 |
| 用户的旧 `data` 正被运行中的进程占用 | rename 失败 → 回退旧目录并记日志；下次启动再试 |
| 持续失败时每次启动重试并最多阻塞 5 s（stubborn 重试 EACCES/EBUSY） | 接受：只影响权限长期异常的安装，且发生在 splash 之前不影响可用性 |
| Windows 卸载勾选「同时删除用户数据」 | `installer.nsi` 已同时删除 `toonflow-data` 与旧 `data`；若这两个名字被做成 junction，`RMDir /r` 可能跟随删除链接目标（既有行为，本次只是多了第二个受支持的名字） |

## 五、评审意见

- 子 agent 初审（2026-10-27 15:07）：见需求文档 R7/R8 与方案 2.5/2.6，全部采纳。另提示「改名失败时 stubborn 重试会让每次启动最多卡 5 s」——接受：只在权限/占用长期异常的安装上出现，加状态标记的收益不如多一处持久化状态，已在风险表登记。
- 子 agent 代码审查（2026-10-27 15:12）：
  - 「打包版 console 不可见，迁移结论无处可查」——采纳，新增 `<数据目录>/logs/desktop.log`（best-effort 追加，失败忽略），成功/失败/共存/占用/链接各写一条。
  - 「目标被同名文件占住时服务端 `mkdir` 会抛错」——采纳，改为继续使用旧目录并记录。
  - 「全大写常量违反 AGENTS 规则 5」——采纳，改为 `dataDirectoryName` / `legacyDataDirectoryName`。
  - 「`AGENTS.md:205` 与 203 行自相矛盾」——采纳，已同步。
  - 「双开竞态」「旧目录是符号链接会新建空目录」——审查看到的是改动前快照，现行实现已处理（改名失败复查目标、链接沿用重定向），夹具用例 6/10 覆盖。
  - 「`isDirectory()` 已排除链接，`!isSymbolicLink()` 冗余」——现状已用 `lstat` + 两边分别判断，保留可读性写法。
  - 「不该新增 `.test.ts`」——遵循 AGENTS，夹具放 `/tmp` 跑完即删。
- 子 agent 复核第二轮（2026-10-27 15:16）：`TOONFLOW_DATA_DIR` 归一为绝对路径、调用点兜底 catch 回退前复查目标、`installer.nsi` 加过渡说明注释，均已采纳；NSIS 对 junction 执行 `RMDir /r` 的既有风险列入接受项；Windows 路径（junction 识别、rename、卸载）仍属静态核对。
- 子 agent 复核（2026-10-27 15:15）：代码层无阻断项，采纳两条建议——迁移日志不再往安装根目录建 `logs/`（只写已知数据目录），并给 `desktop.log` 加 256 KB 轮转；`deploy-local.sh` 的数据目录改为跟随 `APP` 所在目录。回滚说明按「必须手动改回」修正。
- 用户评审：
