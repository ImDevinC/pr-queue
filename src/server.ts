import { createHmac, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import { createPool } from "./db/client.js";
import { applyConfiguration, getQueue } from "./db/storage.js";
import { loadEnvironment } from "./env.js";
import { createGithubApi } from "./github/api.js";
import { createWebhookProcessor } from "./github/processor.js";

const environment = loadEnvironment();
const config = await loadConfig(environment.CONFIG_PATH);
const pool = createPool(environment.DATABASE_URL);
await applyConfiguration(pool, config);
const github = createGithubApi({
  appId: environment.GITHUB_APP_ID,
  privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  apiUrl: environment.GITHUB_API_URL,
});
const processor = createWebhookProcessor({ pool, config, github });
const app = Fastify({ logger: true });

app.addContentTypeParser(
  "application/json",
  { parseAs: "buffer" },
  (_request, body, done) => {
    done(null, body);
  },
);

app.get("/healthz", async () => ({ status: "ok" }));

app.post("/github/webhook", async (request, reply) => {
  const rawBody = Buffer.isBuffer(request.body)
    ? request.body
    : Buffer.from(JSON.stringify(request.body ?? {}));
  const signature = request.headers["x-hub-signature-256"];
  if (
    typeof signature !== "string" ||
    !verifySignature(rawBody, signature, environment.GITHUB_WEBHOOK_SECRET)
  ) {
    return reply.code(401).send({ error: "Invalid webhook signature" });
  }

  const deliveryId = request.headers["x-github-delivery"];
  const eventName = request.headers["x-github-event"];
  if (typeof deliveryId !== "string" || typeof eventName !== "string") {
    return reply.code(400).send({ error: "Missing GitHub delivery headers" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    return reply.code(400).send({ error: "Invalid JSON payload" });
  }

  await pool.query(
    `INSERT INTO webhook_deliveries (github_delivery_id, event_name, action, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (github_delivery_id) DO NOTHING`,
    [
      deliveryId,
      eventName,
      typeof payload.action === "string" ? payload.action : null,
      payload,
    ],
  );
  return reply.code(202).send({ accepted: true });
});

app.get("/api/queue", async () => ({
  updatedAt: new Date().toISOString(),
  entries: await getQueue(pool),
}));

if (process.env.NODE_ENV !== "development") {
  await app.register(fastifyStatic, {
    root: resolve("dist/client"),
    wildcard: false,
  });
  app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
}

const server = await app.listen({
  port: environment.PORT,
  host: environment.HOST,
});
const worker = processor.start();
app.log.info(`PR Queue listening at ${server}`);

async function shutdown(): Promise<void> {
  clearInterval(worker);
  await app.close();
  await pool.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

function verifySignature(
  body: Buffer,
  received: string,
  secret: string,
): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(received, "utf8");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
