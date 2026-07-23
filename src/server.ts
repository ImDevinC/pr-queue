import { createHmac, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadConfig } from "./config.js";
import { createPool } from "./db/client.js";
import { migrateDatabase } from "./db/migrate.js";
import { applyConfiguration, getQueue } from "./db/storage.js";
import { loadEnvironment } from "./env.js";
import { createGithubApi } from "./github/api.js";
import { createWebhookProcessor } from "./github/processor.js";
import { createSlackApi, verifySlackSignature } from "./slack/api.js";
import { createSlackProcessor } from "./slack/processor.js";

const environment = loadEnvironment();
const config = await loadConfig(environment.CONFIG_PATH);
const pool = createPool(environment.DATABASE_URL);
await migrateDatabase(pool);
await applyConfiguration(pool, config);
const github = createGithubApi({
  appId: environment.GITHUB_APP_ID,
  privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  apiUrl: environment.GITHUB_API_URL,
});
const processor = createWebhookProcessor({ pool, config, github });
const slack = createSlackApi(environment.SLACK_BOT_TOKEN);
const app = Fastify({ logger: true });
const slackProcessor = createSlackProcessor({
  pool,
  config,
  github,
  slack,
  reactions: config.slack_reactions,
  logger: app.log,
});

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

app.post("/slack/events", async (request, reply) => {
  const rawBody = Buffer.isBuffer(request.body)
    ? request.body
       : Buffer.from(JSON.stringify(request.body ?? {}));
  const timestamp = request.headers["x-slack-request-timestamp"];
  const signature = request.headers["x-slack-signature"];

  if (
    typeof timestamp !== "string" ||
    typeof signature !== "string" ||
    !verifySlackSignature(rawBody, timestamp, signature, environment.SLACK_SIGNING_SECRET)
  ) {
    return reply.code(401).send({ error: "Invalid Slack signature" });
  }

  // Reject old requests (> 5 minutes) to prevent replay attacks
  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts) || now - ts > 300) {
    return reply.code(403).send({ error: "Request too old" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    return reply.code(400).send({ error: "Invalid JSON payload" });
  }

  // Handle URL verification challenge from Slack
  if (payload.type === "url_verification" && typeof payload.challenge === "string") {
    return reply.code(200).send({ challenge: payload.challenge });
  }

  // Only process event callbacks
  if (payload.type !== "event_callback") {
    return reply.code(200).send({ ok: true });
  }

  const event = payload.event as Record<string, unknown> | undefined;
  if (!event || event.type !== "message") {
    return reply.code(200).send({ ok: true });
  }

  // Skip bot messages, edited messages, thread broadcasts, etc.
  const subtype = typeof event.subtype === "string" ? event.subtype : undefined;
  if (subtype && subtype !== "") {
    return reply.code(200).send({ ok: true });
  }

  const channelId = typeof event.channel === "string" ? event.channel : undefined;
  const eventTs = typeof event.ts === "string" ? event.ts : undefined;
  const text = typeof event.text === "string" ? event.text : "";

  if (channelId && eventTs) {
    await pool.query(
      `INSERT INTO slack_events (slack_event_id, channel_id, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (slack_event_id) DO NOTHING`,
      [`${channelId}:${eventTs}`, channelId, event],
    );
  }

  return reply.code(200).send({ ok: true });
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
const slackWorker = slackProcessor.start();
app.log.info(`PR Queue listening at ${server}`);

async function shutdown(): Promise<void> {
  clearInterval(worker);
  clearInterval(slackWorker);
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
