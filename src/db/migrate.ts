import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool } from "./client.js";
import { loadEnvironment } from "../env.js";

const environment = loadEnvironment();
const pool = createPool(environment.DATABASE_URL);
const schema = await readFile(resolve("db/schema.sql"), "utf8");

try {
  await pool.query(schema);
  console.log("Database schema is up to date");
} finally {
  await pool.end();
}
