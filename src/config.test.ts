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
      `organization: acme\nignored_authors:\n  - bot`,
      async (path) => {
        const config = await loadConfig(path);
        expect(config.organization).toBe("acme");
        expect(config.repositories).toEqual([]);
        expect(config.repositorySet).toEqual(new Set());
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
