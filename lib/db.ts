import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const databaseUrl = process.env.VERCEL_ENV === "preview" ? process.env.PREVIEW_DATABASE_URL : process.env.DATABASE_URL;
if (process.env.NODE_ENV === "test" && process.env.TEST_ISOLATED_DB !== "1") {
  throw new Error("Run tests with npm test to use the isolated database.");
}
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

// Pooled (PgBouncer) URL in production; keep pool tiny because serverless
// functions each hold their own client.
const adapter = new PrismaPg({
  connectionString: databaseUrl,
  max: process.env.TEST_ISOLATED_DB === "1" ? 1 : 3,
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
