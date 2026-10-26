// The test entry point creates a fresh loopback-only database before Vitest.
// Never load dotenv or let a direct Vitest invocation reuse a personal database.
if (process.env.TEST_ISOLATED_DB !== "1") {
  throw new Error("Run npm test to use the isolated database.");
}
process.env.AGENT_MODE = "mock";
