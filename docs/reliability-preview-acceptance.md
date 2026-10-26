# 可靠性 Preview 验收

验收时间：2026-10-25/26（Asia/Shanghai）。源分支 `codex/fix-coach-reliability`，提交 `1be647ca4228a90f7536c9b030563f7a5c0f9277`。

结果：**通过**。随后以 `feat/agent-beta-evolution` 为基础适配可靠性修复，保留 Clerk、多用户菜品归属、用户时区、ScenarioPlugin、Inngest 和 Trace 指标。

## 环境与证据

- [Vercel Ready 部署](https://vercel.com/xue-xue/proactive-coach/4GDLihJMPArvbj7tVB7imNFbepnp)
- [受保护 Preview](https://proactive-coach-77ynu30vc-xue-xue.vercel.app)
- 新建独立 Neon Free 测试资源 `proactive-coach-preview-reliability`；仅 Preview 分支连接，未读取或修改生产数据库。
- Preview 专用数据库变量、所有者登录密码和 Cron 密钥；凭据不进入仓库、报告或截图。
- 使用虚构测试画像、虚构餐食完成情况和虚构体重，测试消息未发送给外部用户。

| 边界 | 结果 | 证据 |
| --- | --- | --- |
| 迁移与云端构建 | PASS | 独立 Preview 迁移成功，部署 Ready |
| 访问控制 | PASS | 未登录的 meals/trace/onboarding 跳转登录；错误密码拒绝；正确登录可完成 onboarding |
| Cron 授权与路由 | PASS | 无授权 401；未知触发 `constructor` 返回 400 |
| 晨间真实模型 | PASS | REAL / COMPLETE；候选 → 计划 → 最终消息 |
| 换菜与反馈 | PASS | REAL / COMPLETE；新菜显示为当前方案，归因反馈 unavailable 已保存 |
| 午间完成 | PASS | REAL / COMPLETE；沿用换后的计划，按钮后状态 COMPLETED |
| 晚间与打卡 | PASS | REAL / COMPLETE；记录 69.8kg 后卡片和最近体重一致 |
| 并发触发 | PASS | 同时两次 morning：200 与 409，只有一条正常晨间投递 |
| 数据一致性 | PASS | PLAN_GENERATED、ACTION_SWAP、ASK_USER_RESPONDED、ACTION_COMPLETE、CHECKIN 各一次；每个最终消息有 deliveryKey |
| PostgreSQL 多连接租约 | PASS | 不同 backend pid 的真实连接验证同用户互斥、不同用户并行、token 替换 fencing、旧任务不得删除新租约、过期后可重取 |

真实模型 Trace：morning `cmvo0pe43000307l5ypuwafzf`、swap、lunch `cmvo0rnus000507l5l0c94n7g`、evening `cmvo0szcd000807l57jhhayx6` 均 COMPLETE。swap 模型重复调用偏好工具时，证据键确保业务事件不重复。

## Beta 整合约束

- 不移植单用户密码登录或 `findFirst()` 用户选择；沿用 Clerk 当前会话和明确的后台 userId。
- 保留用户本地日期、dayEndsAt、队列 scheduledAt/dateKey，补充 Web/Cron/队列共用租约。
- 新增 `20261026000100_reliability_beta` 迁移，沿用已应用的 `beta_multi_user` 历史，不重复创建 CheckIn 唯一索引。
- 旧 dedupeKey 兼容保留；无计划历史消息按队列日期或用户时区回填 deliveryKey。历史重复记录保留。
- 未投递的失败必须使 Inngest 重试；成功降级保留 INCOMPLETE，未反馈使用 NO_RESPONSE。
- 默认测试使用全新临时数据库；真实模型 smoke 仅在明确启用的隔离测试环境运行。

本记录证明可靠性分支的 Preview 验收；多用户 Beta 的新增适配由其回归测试另行验证。生产发布、真实用户灰度与一天 shadow 观察仍按 [Beta rollout](beta-rollout.md) 执行。

## Beta 适配验证（2026-10-26）

- 隔离数据库全套回归：68 项通过，1 项真实模型 smoke 按 opt-in 设计跳过；18 个测试文件。随后补充模型中途失败的 Trace 保留回归，该文件 4/4 通过，合计 69 项回归通过。
- 覆盖 Clerk 当前用户隔离、他人计划/消息/私有菜品拒绝、重复换菜/完成/归因/打卡、部分换菜恢复、租约 fencing、上海/纽约本地日期、午夜队列重试与 Cron 授权/重试响应。
- 升级回归从原 master 和已应用 Beta 迁移开始，保留 9 条历史消息和既有 CheckIn 唯一约束；旧模型 ASK_USER 没有 dedupeKey 时仍占正常日常槽，只有明确的 swap_attribution 占独立 ASK_USER 槽。
- TypeScript、ESLint、差异空白检查及本地 Node 24 / Next.js webpack 构建通过；云端默认构建由整合 PR 的 CI 验证。
- Beta 真实用户上线仍需要其独立数据库、Clerk、Inngest、Sentry 等配置和 shadow 观察；上述测试不等同于 Beta 生产发布验收。
