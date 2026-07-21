import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type pg from "pg";
import { createPool } from "./client.js";
import { loadEnvironment } from "../env.js";

export async function migrateDatabase(pool: pg.Pool | pg.PoolClient): Promise<void> {
  const schema = await readFile(resolve("db/schema.sql"), "utf8");

  await pool.query(schema);
  console.log("Database schema is up to date");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const environment = loadEnvironment();
  const pool = createPool(environment.DATABASE_URL);

  try {
    await migrateDatabase(pool);
  } finally {
    await pool.end();
  }
}
