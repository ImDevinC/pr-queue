import { createHmac, timingSafeEqual } from "node:crypto";

export interface SlackApi {
  addReaction(channel: string, timestamp: string, emoji: string): Promise<void>;
}

export function verifySlackSignature(
  body: Buffer,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  const base = `v0:${timestamp}:${body.toString("utf8")}`;
  const expected = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

export function createSlackApi(token: string): SlackApi {
  async function api(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Slack API ${method} failed: ${response.status}`);
    }
    const result = (await response.json()) as { ok: boolean; error?: string };
    if (!result.ok) {
      if (result.error === "already_reacted") return result;
      throw new Error(`Slack API ${method} error: ${result.error ?? "unknown"}`);
    }
    return result;
  }

  return {
    async addReaction(channel, timestamp, emoji) {
      await api("reactions.add", {
        channel,
        timestamp,
        name: emoji.replace(/:/g, ""),
      });
    },
  };
}
