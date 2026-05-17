import { buildApp } from "@/app";
import { db } from "@/shared/database/client";
import { runMigrations } from "@/shared/database/migrate";

export async function buildTestServer() {
  await runMigrations(db);
  const app = await buildApp();
  await app.ready();
  return app;
}