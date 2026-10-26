# Beta rollout runbook

## Before deployment

1. Run `npm run beta:preflight`; bind the legacy user with `npm run bind:clerk-user -- <userId> <clerkId>`.
2. Configure Clerk allowlist and the Clerk, Inngest, Sentry, database and DeepSeek environment variables.
3. Deploy the additive migration, then deploy the application.
4. Keep `ASYNC_AGENT_ENABLED=false` and `ASYNC_AGENT_SHADOW=true`.

## Reliability integration

The reliability source preview passed its [isolated online acceptance](reliability-preview-acceptance.md). Beta uses its own additive `20261026000100_reliability_beta` migration after `20260828140500_beta_multi_user`; do not apply the single-user reliability migration on this path or edit applied migration history.

Configure `PREVIEW_DATABASE_URL` and `PREVIEW_DIRECT_DATABASE_URL` for a separate Beta test database before deploying a Beta Preview. The single-user reliability Preview database has a different migration history and must not be reused for Beta. Preview builds and the Prisma CLI refuse to fall back to production connection variables.

Use Node.js 24. `npm test` / `npm run test:ci` automatically create and destroy a fresh loopback-only database, apply all Beta migrations and use mock model calls. The real model smoke workflow remains a manual opt-in against its disposable CI PostgreSQL service.

One database lease serializes each user's Web, recovery-Cron and Inngest operations. Different users remain independent. Model calls run outside long database transactions; each write checks the current lease token. A failed turn with no final delivery throws so Inngest retries; a delivered fallback is recorded as INCOMPLETE. A plan with no response remains NO_RESPONSE rather than being counted as completed.

## Staged rollout

1. Enable Inngest scheduling in staging for one mock user and confirm event IDs, local dates and message deduplication.
2. Set `ASYNC_AGENT_ENABLED=true` while retaining shadow mode in production. Compare due-user output with the expected local reminder windows for at least one day.
3. Disable shadow mode for 5 allowlisted users, then 20 users, then the target Beta cohort. At each stage check fallback rate, duplicate-message rate, task retries, database connections and p95 duration.
4. Only increase Inngest concurrency from 5 after the database and Vercel duration metrics show headroom.

## Rollback drill

1. Set `ASYNC_AGENT_ENABLED=false`; do not remove events, plans, Clerk mappings or meal ownership.
2. Confirm new scheduler runs report `disabled: true`.
3. Use the protected `/api/cron/{morning|lunch|evening}?userId=<id>` endpoint with `CRON_SECRET` for a single-user recovery trigger.
4. Verify the event/message dedupe key prevents a recovery trigger from duplicating an already delivered feed item.
5. Restore async sending only after the failed layer is understood; schema rollback is not required.
