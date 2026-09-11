# Beta rollout runbook

## Before deployment

1. Run `npm run beta:preflight`; bind the legacy user with `npm run bind:clerk-user -- <userId> <clerkId>`.
2. Configure Clerk allowlist and the Clerk, Inngest, Sentry, database and DeepSeek environment variables.
3. Deploy the additive migration, then deploy the application.
4. Keep `ASYNC_AGENT_ENABLED=false` and `ASYNC_AGENT_SHADOW=true`.

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
