# 测试结果：看门狗修复的审查闭环

日期：2026-10-28 18:20

## 一、审查查出的问题与处置

| # | 问题 | 严重度 | 处置 |
| --- | --- | --- | --- |
| 1 | 宿主层无任务级超时；`settledAt` 只在 Promise finally 写，供应商挂住则任务永不回收，1000 上限可被打满 | 中 | 已补三道超时（见下） |
| 2 | `visibilitychange` 注册在 `??=` 工厂外，9 个节点包 + 宿主 chunk 各注册一个，热重载再叠加、永不移除 | 中低 | 已移进 `createMediaTasks()` |
| 3 | `4_bugs_fix/INDEX-2026-10.md` 被我整表覆盖，丢了 15 条历史 | 中 | 已恢复，现有 16 条 |
| 4 | 90 秒失败窗口现在是唯一时间型取消，语义需重写 | 建议 | 未改代码，语义已在文档说明 |
| 5 | `resume()` 不能抢占在途 poll，「接近 0」表述夸大 | 建议 | 未改代码，表述已纠正 |
| 6 | `nodeAi.ts:145` 陈旧注释称「服务端无心跳过期兜底」 | 建议 | 已改 |
| 7 | `deploy-local.sh` 用 `rsync` 无 `--delete`，旧 chunk 残留 | 建议 | 未改（见待办） |
| 8 | `poll()` 缺入口守卫；`clearTimeout` 无法取消已入队回调 | 建议 | 已加 `if (polling) return` |

## 二、补的三道超时

| 位置 | 上限 | 理由 |
| --- | --- | --- |
| `generation.ts` `generateMedia` | 60 分钟墙钟 | 长于内置视频供应商的 30 分钟；自定义供应商不自带超时，这道闸是唯一兜底 |
| `generation.ts` `downloadAsset` | 5 分钟 | 只防「连上但不出字节」，不与生成耗时混谈 |
| `provider.ts` `media.bytes` | 5 分钟 | 原本无 signal 无 timeout |

确认 signal 链路可达：`provider.ts:414` 把 signal 注入 `provider.signal`，`:417` 的 `tool.fetch` 也合并了它，供应商 `apiMart.ts:230/275` 用 `AbortSignal.any([timeout, this.signal])` —— 因此 `AbortSignal.timeout` 能真正打断挂住的请求，不是无效摆设。

## 三、验证

| 用例 | 结果 |
| --- | --- |
| `@toonflow/server` typecheck | 0 |
| `@toonflow/nodes-scaffold` typecheck | 0 |
| 9 个节点包 production build | 全部成功 |
| 服务端 standalone build | 23.28 MB |
| 桌面入口打包 + 部署 | 成功 |
| 墙钟上限可单独中止 | PASS（`TimeoutError`） |
| 外部取消可单独中止、不误报超时 | PASS |
| 上限先到时 `reason.name === "TimeoutError"` | PASS |
| `poll()` 双进入只执行一次 | PASS |
| `poll()` 之后可正常再次执行 | PASS |
| 各节点包 `visibilitychange` 注册次数 | 均为 1（director3d 的另外 2 处是自身模型加载与语音输入，与本次无关） |
| `4_bugs_fix/INDEX` 条目数 | 16（原 15 + 本次 1） |

## 四、未处置项（明确记录）

- **90 秒窗口的残余误杀**：`AbortSignal.timeout(10000)` 让「服务端只是慢」也被计入失败，连续 90 秒即可取消一个健康任务。这是原 bug 的同类错误反向形态。修法需要给 status 请求独立可中断 controller，属独立改动。
- **`resume()` 抢占**：`polling` 期间的 resume 直接返回，最坏延迟 = 在途请求剩余时间（≤10s）+ 1s，不是「接近 0」。
- **部署脚本不清理旧产物**：`rsync -a` 无 `--delete`，已部署目录有 1792 个资产文件 vs 构建产物 1038 个，旧 `nodeAi` chunk 长期残留。当前 `index.html` 不引用它们，但与热重载叠加时是隐患。
- **无自动化回归测试**：`apps/server` 没有任何 `*.test.ts`，本次验证仍是源码断言 + 调度复刻脚本，没有留下可重跑的测试。
