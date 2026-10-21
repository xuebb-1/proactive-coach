# 修复分支的验证与部署

本项目保留单用户模式。个人页面和 Server Actions 均需要所有者登录；Cron 使用独立的 Bearer 密钥。

## 环境变量

所有会提供页面的环境都配置：

- `ADMIN_PASSWORD`：独立的访问密码，至少 16 个字符，推荐使用密码管理器生成的随机密码。
- `SESSION_SECRET`：至少 32 个字符的随机密钥。更换密码或密钥会使已有会话失效。
- `CRON_SECRET`：定时任务密钥。生产环境缺失时返回 503，不接受匿名调用。
- `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`：真实模型配置。`AGENT_MODE=mock` 只用于测试。
- Production 范围：`DATABASE_URL` 和 `DIRECT_DATABASE_URL`。

Preview 范围只使用独立测试库或 Neon 分支：

- `PREVIEW_DATABASE_URL`
- `PREVIEW_DIRECT_DATABASE_URL`

不要在 Preview 中复用生产库。构建和运行时都不会把缺失的 Preview 连接回退到生产连接；检测到相同连接串时构建失败。不同连接串也可能指向同一库，配置时须确认数据库或 Neon 分支本身不同。登录凭据同样建议区分环境。

Vercel 的 Build Command 使用 `npm run build`（或 `npm run vercel-build`）。Vercel 构建会为所属环境的数据库执行 `prisma migrate deploy`，普通本地构建不执行迁移。预览环境未配置隔离库时，构建会明确失败；不会自动修改生产数据库。

## 本地回归

```bash
npm ci
npm test
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
```

`npm test` 自动启动仅监听本机的临时 PGlite 数据库，执行全部迁移，测试后销毁；不读取真实数据库连接。直接执行 Vitest 会被数据库保护检查拒绝。PGlite 用于 SQL、事务和业务回归，不替代真实 Postgres 上的多连接并发验收。

Windows 受限环境中，如默认 Turbopack 无法创建目录联接，可使用 `npm run build -- --webpack` 验证同一应用。

## 迁移与数据

新增字段均为增量修改，历史消息和偏好保留。迁移会为每个已有消息时段的第一条记录补充投递唯一标识，历史重复消息保留。

若同一用户、同一天已有多条 CheckIn，迁移会回滚并报错，不会自行删除体重记录。部署前查询：

```sql
SELECT "userId", "date", COUNT(*)
FROM "CheckIn"
GROUP BY "userId", "date"
HAVING COUNT(*) > 1;
```

有结果时，应先备份并由所有者确认保留哪条记录，再重试迁移。如果已经执行失败，修正重复记录后先运行 `npx prisma migrate resolve --rolled-back 20261021000100_reliability`，再运行 `npx prisma migrate deploy`。不要直接修改历史 `AUTO_ACCEPTED` 数据；新逻辑使用 `NO_RESPONSE` 表示未反馈，页面对旧状态也显示“未反馈”。

## 预览验收

1. 未登录访问首页、菜品库、Trace 和 onboarding 均进入登录页；直接提交修改操作也不能绕过验证。
2. 使用测试账户走早间推荐 → 换菜 → 归因选择 → 午间完成 → 晚间打卡；换菜后卡片显示当前计划。
3. 重复提交不会重复增强偏好；过期消息和结束计划不能再次处理。
4. 明确忌口不会因候选不足被放宽；候选为空时显示补充菜品的提示。
5. 模拟模型异常，确认备用安排与降级 Trace；备用流程也失败时 Cron 返回 503。
6. 在真实 Postgres 的预览库上并发调用同一任务：最多一个执行，其余返回 409，最终每个时段只保留一个带投递键的消息。
7. 确认页面、日志和数据库状态后再合并发布。生产不显示本地开发触发面板。

数据库操作使用 5 分钟互斥租约，模型单轮总超时 90 秒；每次写入短事务都会验证租约，避免过期执行器写入迟到结果。进程中断后，租约到期可以重试；反馈证据和消息投递都有唯一标识。

本分支不会清理或重建已有偏好。历史错误反馈的修正需另行确认。
