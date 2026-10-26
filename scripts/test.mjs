import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Never load .env here. Tests always use a fresh, loopback-only database.
const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 20 });
let exitCode = 1;
try {
  for (const name of (await readdir(new URL("../prisma/migrations/", import.meta.url))).sort()) {
    if (!/^\d+_/.test(name)) continue;
    const file = new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url);
    await db.exec(await readFile(file, "utf8"));
  }
  await server.start();
  const databaseUrl = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable`;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, VERCEL_ENV: "", DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: databaseUrl, TEST_ISOLATED_DB: "1", AGENT_MODE: "mock", DEEPSEEK_API_KEY: "", RUN_REAL_MODEL_SMOKE: "false", ASYNC_AGENT_ENABLED: "false" },
  });
  exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => resolve(code ?? 1)); });
} finally {
  await server.stop();
  await db.close();
}
process.exitCode = exitCode;
