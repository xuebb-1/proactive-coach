import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const env = { ...process.env };
const preview = env.VERCEL_ENV === "preview";
if (preview) {
  if (!env.PREVIEW_DATABASE_URL || !env.PREVIEW_DIRECT_DATABASE_URL) {
    throw new Error("Preview requires separate PREVIEW_DATABASE_URL and PREVIEW_DIRECT_DATABASE_URL. Production credentials are never used as a fallback.");
  }
  if (env.PREVIEW_DATABASE_URL === env.DATABASE_URL || env.PREVIEW_DIRECT_DATABASE_URL === env.DIRECT_DATABASE_URL) {
    throw new Error("Preview and production database URLs must differ.");
  }
  env.DATABASE_URL = env.PREVIEW_DATABASE_URL;
  env.DIRECT_DATABASE_URL = env.PREVIEW_DIRECT_DATABASE_URL;
}
for (const [cli, args] of [
  [prismaCli, ["generate"]],
  ...(env.VERCEL_ENV === "production" || preview ? [[prismaCli, ["migrate", "deploy"]]] : []),
  [nextCli, ["build", ...process.argv.slice(2)]],
]) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
