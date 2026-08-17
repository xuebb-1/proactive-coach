# proactive-coach

一个几乎没有"聊天界面"感觉的个人 Agent：你不用打开对话框，它会按早/午/晚三个时间点主动找你。减肥是演示场景，但这个项目真正要展示的是**一个 tool-using Agent 的深度**——有规划、有工具边界、有跨轮记忆、有可观测 Trace，而不是一个"定时任务 + 模板拼文案"的自动化脚本。

## 核心设计

**Agent 内核**：每个触发点（早/午/晚/换一个）都会启动一轮 `runAgentTurn` / `runActionTurn`——DeepSeek（[@ai-sdk/deepseek](https://ai-sdk.dev/providers/ai-sdk-providers/deepseek)，通过 Vercel AI SDK 的 `generateText` + `tools` + `stopWhen` 多步循环）读取记忆、做出带理由的判断，再通过一组受限的工具把结果落库——模型不能直接写数据库或"假装"发了消息，必须经过工具，工具本身还会做白名单校验（见下）。

**工具集**（[lib/agent/tools/](lib/agent/tools/)）：

| Tool | 作用 |
| --- | --- |
| `get_user_profile` | 读 Tier1 画像与人设 |
| `search_preferences` | 按 category/confidence 查 Tier2 |
| `get_recent_episodes` | 读近 N 天 Tier3 事件 |
| `get_engagement_trend` | 参与度趋势（近 7 天 vs 前 7 天完成率） |
| `list_candidate_meals` | 候选（已按偏好/重复过滤），模型只能从这里选，不能编菜名。候选库随用户的吃饭方式切换：自己做饭是菜谱，吃食堂是打菜策略，点外卖是下单策略——推荐必须是用户真能执行的动作 |
| `create_daily_plan` / `update_daily_plan` | 写入/更新当日计划（`upsert` 语义，mealKey 会被代码白名单校验） |
| `send_proactive_message` / `ask_user` | 把最终文案或澄清问题写入 Feed，二选一，是本轮通常的最后一步 |
| `record_preference_signal` | 记录一次离散的「喜欢/不喜欢」信号——置信度的增量由代码算，模型不能直接给数值 |
| `log_episode` | 写 Tier3 事件日志 |

这些约束不是写在 prompt 里的君子协定，是代码里的 `if` 判断（[lib/agent/tools/planning.ts](lib/agent/tools/planning.ts) 的 `assertValidMealKey`、[lib/memory/preference.ts](lib/memory/preference.ts) 的固定置信度增量）——这是「Agent 突破纯 LLM 胡编上限」这句话在这个项目里唯一站得住的地方。

**哪里真正需要 Agent，哪里不需要**：早/午/晚三个 cron 触发和「换一个」按钮会经过 Agent（[lib/agent/runner.ts](lib/agent/runner.ts) 的 `runAgentTurn`/`runActionTurn`）；「确认/完成/跳过」是无歧义的状态转移，直接走确定性代码（[lib/orchestrator/actions.ts](lib/orchestrator/actions.ts)），不套一次 LLM 调用——这本身也是一种设计判断，硬套 Agent 只会增加延迟和不确定性，不增加"深度"。这三种动作仍各记一条 `source: DETERMINISTIC` 的 trivial trace，保证 `/trace` 时间线不出现空洞。

**三层记忆**：

- Tier 1（`UserProfile` / `PersonaProfile`）：onboarding 显式填写，几乎不变。
- Tier 2（`PreferenceMemory`）：从按钮行为/Agent 信号推断出的偏好，带置信度和衰减（[lib/memory/preference.ts](lib/memory/preference.ts)）。
- Tier 3（`EpisodicLog`）：只增不改的原始事件日志，用于计算参与度趋势、还原偏好。

记忆不只是「写进去」，还有一个闭环（[lib/memory/preference.ts](lib/memory/preference.ts)、[lib/memory/metrics.ts](lib/memory/metrics.ts)）：

- **归因**：换菜可能是不喜欢、也可能只是今天没供应。`dislike` 置信度逼近过滤阈值时，Agent 会 `ask_user` 问一句原因——答「不喜欢」则确认为 `user_confirmed`（不再衰减），答「没供应/换口味」则回退这次的置信度增量，避免把环境噪音学成口味偏好。
- **冲突消解**：`dislike:X` 被强化时 `prefer:X` 同步衰减（反之亦然），对立信号不会同时高置信共存。
- **效果度量**：`/trace` 顶部有一个指标面板——周换菜率走势、重复踩雷率、推断精确率——全部从 Tier 3 事件日志算出，用数据回答「记忆到底是帮了决策还是噪音」。

**Trace（可观测层）**：每一轮 Agent 都会落一条 `AgentTrace`（[lib/agent/trace.ts](lib/agent/trace.ts)），记录模型的推理文本、每一次工具调用与返回，`/trace` 页面按时间列出、可展开查看。`source` 字段区分 `REAL`（真实 DeepSeek 调用）/ `MOCK`（无 key 时的确定性工具循环，仅供离线开发）/ `DETERMINISTIC`（无模型参与的按钮动作），避免把 mock 脚本冒充成真实 Agent 推理。

**护栏**（[lib/orchestrator/daily-orchestrator.ts](lib/orchestrator/daily-orchestrator.ts)、[lib/agent/runner.ts](lib/agent/runner.ts)）：

- 幂等性按「今天这一轮的消息是否已发出」判断，不是按「计划是否已存在」——避免真实 LLM 调用一半失败（plan 建了、消息没发出）导致当天永久静默。
- `stopWhen: stepCountIs(6)` 限制单轮步数；命中上限仍未产出消息时，发一条确定性兜底消息，而不是让用户当天什么都收不到。

**单用户**：没有登录/多租户，`prisma.user.findFirst()` 即拿到唯一用户（见 [lib/user.ts](lib/user.ts)）。

## 本地开发

数据库是 Postgres（生产和本地共用一个 Neon 实例，或自建一个）。先把 `.env.example` 复制为 `.env`，填入 `DATABASE_URL`（pooler 连接串，运行时用）和 `DIRECT_DATABASE_URL`（直连串，迁移用；Neon 上就是去掉 `-pooler` 的同一地址）。

```bash
npm install
npm run db:migrate   # 首次运行，在数据库里建表
npm run dev
```

打开 http://localhost:3000，第一次会跳转到 `/onboarding` 填写目标、忌口、语气偏好等。

因为本地不会真的跑 Vercel Cron，页面底部有一个「开发者工具（本地测试用）」折叠面板，点击「触发早上/中午/晚上」即可手动模拟每日三次的主动消息，测试完整闭环。

### 接入真实 DeepSeek（推荐，否则只是 mock 脚本）

在 `.env` 里填：

```
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-v4-pro   # 或 deepseek-v4-flash；旧别名 deepseek-chat/deepseek-reasoner 已于 2026-07-24 停用
```

不填 key（或显式设 `AGENT_MODE=mock`）时会走确定性 mock 工具循环——同一套工具实现，只是跳过真实模型推理，方便离线开发，但 `/trace` 上会标 `mock · 离线开发`，不适合当作最终演示。

## Demo 脚本

1. `/onboarding` 填 tone + hook（比如 event 类型填一个未来日期，倒计时会被喂给模型）。
2. 点「触发早上」，打开 `/trace`：能看到模型先读 profile / 参与度趋势 / 偏好，写一段推理文字，再调用 `list_candidate_meals` → `create_daily_plan` → `send_proactive_message`。
3. 回到今日卡，点「换一个」：`/trace` 里出现新的一轮（trigger=swap），`update_daily_plan` + `record_preference_signal`；点「确认/完成/跳过」对比一下——这几个是 `DETERMINISTIC`，没有模型推理步骤。
4. 强调：`create_daily_plan`/`update_daily_plan` 会拒绝任何不在 `list_candidate_meals` 候选里的 mealKey（代码里能直接展示 `assertValidMealKey`），这不是 prompt 里的君子协定。
5. 触发「中午」「晚上」，观察 lunch 是怎么复用 morning 的 `DailyPlan`（而不是新建一条）——`DailyPlan` 的 `(userId, date, type)` 唯一约束决定了这一点。

## 部署（Vercel）

1. 推送到 GitHub，在 Vercel 导入这个仓库（代码已经是 Postgres 方言，不需要额外改造）。
2. 建一个 Neon（或 Vercel Postgres）免费库，在 Vercel 项目环境变量里设置 `DATABASE_URL`（pooler 连接串）和 `DIRECT_DATABASE_URL`（直连串）。构建命令里的 `prisma migrate deploy` 会在每次部署时自动把未应用的迁移建进库里。
3. 再设置 `CRON_SECRET`（任意随机字符串）、`DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`。设置 `CRON_SECRET` 后 Vercel Cron 会自动带上 `Authorization: Bearer $CRON_SECRET`，`/api/cron/[type]` 会校验这个值，避免接口被外部随意调用（同时首页的开发者面板在线上会因缺少密钥而失效，属于预期行为）。
4. `vercel.json` 已经配置了三个 Cron（07:30 / 12:00 / 20:30 北京时间，换算成 UTC；Hobby 计划有 ±59 分钟的触发弹性），以及 `"regions": ["sin1"]` 把函数固定在新加坡、和 Neon 同区域——不配的话函数默认在美东，每次数据库查询多 200ms+ 跨洋往返。如果你在 onboarding 里改了提醒时间，需要同步手动改 cron 表达式——Vercel Cron 是部署时静态配置的，不会读数据库里的个性化时间。

## 目录结构

```
app/
  page.tsx              今日卡（唯一主界面，链到 /trace）
  trace/page.tsx         Agent Trace 可观测面板
  onboarding/page.tsx    首次引导表单
  actions.ts             Server Actions（按钮点击、体重打卡、onboarding 提交）
  api/cron/[type]/       Vercel Cron 调用的三个每日触发端点
  components/            今日卡用到的展示组件
lib/
  agent/
    provider.ts          DeepSeek / mock provider 选择
    tools/                Agent 工具集（memory / planning / messaging）
    prompts.ts            system prompt + 各 trigger 的 goal prompt
    runner.ts             runAgentTurn / runActionTurn，多步工具循环 + Trace 落库
    trace.ts              AgentTrace 读写与 step 类型
  db.ts                  Prisma Client 单例（driver adapter 模式）
  user.ts                单用户 helper
  date.ts                日期 key 工具
  memory/                Tier 2 / Tier 3 记忆读写
  orchestrator/          Cron 触发入口、参与度计算、按钮状态机（confirm/complete/skip 走这里，不经 Agent）
  scenarios/weightloss/  减肥场景的候选库（按吃饭方式分自炊/食堂/外卖三套）与过滤逻辑（Agent 的工具数据源，唯一场景，未做插件抽象）
prisma/
  schema.prisma          数据模型（含 AgentTrace）
```

## 明确不做的（避免又漂回产品向）

- Web Push / 邮件通知
- 多场景插件化（做饭、护肤等）
- 自由长对话主界面
- LangGraph / 更重的 multi-agent 编排——这个项目要展示的是对 Agent 架构本身的理解，不是框架封装能力
