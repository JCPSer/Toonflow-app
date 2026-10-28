# 测试结果：生成任务被「页面长时间未连接」误杀

日期：2026-10-28 17:20

## 一、静态检查

| 项目 | 结果 |
| --- | --- |
| `@toonflow/server` typecheck | 0 |
| `@toonflow/nodes-scaffold` typecheck | 0 |
| 9 个节点包 production build | 全部成功 |
| 服务端 standalone build | 成功，`build/server/index.js` 23.28 MB |
| 桌面入口打包 | 成功，23,561,168 B |

## 二、服务端看门狗移除（源码级断言 + 运行期契约）

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| `tasks.ts` 不含「长时间未连接」文案 | 移除 | PASS |
| `tasks.ts` 不含 `touchedAt` 字段 | 移除 | PASS |
| 不存在 `touchedAt + N` 形式的超时判断 | 移除 | PASS |
| 结算后 5 分钟清理仍存在 | `settledAt + 300000` | PASS |
| 1000 任务上限仍存在 | `tasks.size >= 1000` | PASS |
| `cancel()` 仍立即生效 | 返回 499「生成已取消」 | PASS（实测 `status` 返回 code 499、message 正确） |
| 未知 taskId | 404「生成任务不存在或已过期」 | PASS |

## 三、前端可见性补轮询（调度语义复刻验证）

| 用例 | 期望 | 结果 |
| --- | --- | --- |
| 无在途任务时 `resume()` | 不触发轮询（零开销） | PASS |
| 有在途任务且已有排队定时器 | 丢弃定时器并立刻 poll | PASS，日志：`丢弃排队定时器 → poll#1` |
| `polling` 期间再次 `resume()` | 不并发，最多 1 次 | PASS |

关键修正：初版 `resume()` 用 `timer !== undefined` 直接 return，这在后台节流场景下正好会「因为定时器已排队而不补轮询」，违背目的。改为 `clearTimeout` 后立即 poll，才真正缩短切回可见时的感知延迟。

## 四、产物核对

| 产物 | 检查 | 结果 |
| --- | --- | --- |
| `build/nodes/imageGenerationNode.umd.js` | 含 `visibilitychange` | 1 处，PASS |
| `build/server/index.js` | 不含「长时间未连接」 | 0 处，PASS |
| `build/desktop/main/index.js` | 不含「长时间未连接」 | 0 处，PASS |
| `/Applications/toonflow-exec.app/.../bun/index.js` | 已部署且不含残留 | 0 处，23,561,168 B，PASS |

## 五、部署

`deploy-local.sh` 报告 9 个节点包全部 `updated`；桌面入口（含服务端）已安装到 `/Applications/toonflow-exec.app`。重启应用生效。

## 六、未覆盖 / 待手测

- 真实后台 3 分钟切回：需在界面上提交一次图片/视频生成，切走窗口超过 3 分钟再切回，确认不再出现「页面长时间未连接」且能拿到结果。
- 后台切回后的状态刷新延迟是否真的降到 ~0（需观察生成进度条恢复的即时性）。
- 页面真正崩溃时任务是否会按预期在供应商返回后结算并 5 分钟内清理（无法本地构造）。