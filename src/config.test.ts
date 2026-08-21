import { describe, expect, it } from "vitest";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./config.js";

async function withTempYaml(content: string, callback: (path: string) => Promise<void>) {
  const path = join(tmpdir(), `config-test-${Date.now()}-${Math.random()}.yaml`);
  await writeFile(path, content, "utf8");
  try {
    await callback(path);
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

describe("loadConfig", () => {
  it("loads config with explicit repositories", async () => {
    await withTempYaml(
      `organization: acme\nrepositories:\n  - acme/repo-a\n  - acme/repo-b`,
      async (path) => {
        const config = await loadConfig(path);
        expect(config.organization).toBe("acme");
        expect(config.repositories).toEqual(["acme/repo-a", "acme/repo-b"]);
        expect(config.repositorySet).toEqual(
          new Set(["acme/repo-a", "acme/repo-b"]),
        );
      },
    );
  });

  it("loads config with empty repositories array", async () => {
    await withTempYaml(
      `organization: acme\nrepositories: []`,
      async (path) => {
        const config = await loadConfig(path);
        expect(config.organization).toBe("acme");
        expect(config.repositories).toEqual([]);
        expect(config.repositorySet).toEqual(new Set());
      },
    );
  });

  it("loads config with missing repositories option", async () => {
    await withTempYaml(
      `organization: acme`,
      async (path) => {
        const config = await loadConfig(path);
        expect(config.organization).toBe("acme");
        expect(config.repositories).toEqual([]);
        expect(config.repositorySet).toEqual(new Set());
      },
    );
  });

  it("loads slack channels and reactions", async () => {
    await withTempYaml(
      `organization: acme\nslack_channels:\n  - general\n  - dev\nslack_reactions:\n  success: ":rocket:"\n  failure: ":boom:"`,
      async (path) => {
        const config = await loadConfig(path);
        expect(config.slack_channels).toEqual(["general", "dev"]);
        expect(config.slackChannelSet).toEqual(
          new Set(["general", "dev"]),
        );
        expect(config.slack_reactions).toEqual({
          success: ":rocket:",
          failure: ":boom:",
        });
      },
    );
  });

  it("uses default slack reactions when not specified", async () => {
    await withTempYaml(
      `organization: acme`,
      async (path) => {
        const config = await loadConfig(path);
        expect(config.slack_reactions).toEqual({
          success: ":white_check_mark:",
          failure: ":x:",
        });
      },
    );
  });

  it("still rejects repositories outside the organization", async () => {
    await withTempYaml(
      `organization: acme\nrepositories:\n  - other-org/repo`,
      async (path) => {
        await expect(loadConfig(path)).rejects.toThrow(
          "Every configured repository must belong to the configured organization",
        );
      },
    );
  });

  it("still rejects duplicate repositories", async () => {
    await withTempYaml(
      `organization: acme\nrepositories:\n  - acme/repo\n  - acme/repo`,
      async (path) => {
        await expect(loadConfig(path)).rejects.toThrow(
          "Configuration contains duplicate repositories",
        );
      },
    );
  });
});
