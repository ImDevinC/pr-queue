import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const configSchema = z.object({
  organization: z.string().min(1),
  repositories: z.array(z.string().regex(/^[^/]+\/[^/]+$/)).default([]),
  slack_channels: z.array(z.string().min(1)).default([]),
  slack_reactions: z
    .object({
      success: z.string().min(1).default(":white_check_mark:"),
      failure: z.string().min(1).default(":x:"),
    })
    .default({}),
});

export type QueueConfig = z.infer<typeof configSchema> & {
  repositorySet: Set<string>;
  slackChannelSet: Set<string>;
};

export async function loadConfig(path: string): Promise<QueueConfig> {
  const source = await readFile(resolve(path), "utf8");
  const parsed = configSchema.parse(parse(source));
  const repositorySet = new Set(
    parsed.repositories.map((repository) => repository.toLowerCase()),
  );
  const slackChannelSet = new Set(
    parsed.slack_channels.map((channel) => channel.toLowerCase()),
  );

  if (repositorySet.size !== parsed.repositories.length) {
    throw new Error("Configuration contains duplicate repositories");
  }

  if (
    !parsed.repositories.every((repository) =>
      repository
        .toLowerCase()
        .startsWith(`${parsed.organization.toLowerCase()}/`),
    )
  ) {
    throw new Error(
      "Every configured repository must belong to the configured organization",
    );
  }

  return { ...parsed, repositorySet, slackChannelSet };
}
