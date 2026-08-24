import { describe, expect, it } from "vitest";
import { loadEnvironment } from "./env.js";

const baseEnv = {
  DATABASE_URL: "postgresql://localhost/test",
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: "key",
  GITHUB_WEBHOOK_SECRET: "secret",
  SLACK_BOT_TOKEN: "token",
  SLACK_SIGNING_SECRET: "signing-secret",
};

describe("loadEnvironment", () => {
  it("uses default PR_SYNC_INTERVAL_MS when not provided", () => {
    const env = loadEnvironment(baseEnv);
    expect(env.PR_SYNC_INTERVAL_MS).toBe(300000);
  });

  it("parses custom PR_SYNC_INTERVAL_MS", () => {
    const env = loadEnvironment({ ...baseEnv, PR_SYNC_INTERVAL_MS: "60000" });
    expect(env.PR_SYNC_INTERVAL_MS).toBe(60000);
  });

  it("rejects non-numeric PR_SYNC_INTERVAL_MS", () => {
    expect(() =>
      loadEnvironment({ ...baseEnv, PR_SYNC_INTERVAL_MS: "not-a-number" }),
    ).toThrow();
  });

  it("rejects zero PR_SYNC_INTERVAL_MS", () => {
    expect(() =>
      loadEnvironment({ ...baseEnv, PR_SYNC_INTERVAL_MS: "0" }),
    ).toThrow();
  });

  it("rejects negative PR_SYNC_INTERVAL_MS", () => {
    expect(() =>
      loadEnvironment({ ...baseEnv, PR_SYNC_INTERVAL_MS: "-1" }),
    ).toThrow();
  });
});
