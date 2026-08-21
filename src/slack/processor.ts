import type pg from "pg";
import type { QueueConfig } from "../config.js";
import {
  activateQueueEntry,
  ensureOrganizationAndRepository,
  findPullRequest,
  getInstallationIdForOrganization,
  updateReview,
  upsertPullRequest,
  upsertStatus,
} from "../db/storage.js";
import type { GithubApi } from "../github/api.js";
import type { GithubPullRequest } from "../github/types.js";
import type { SlackApi } from "./api.js";

export interface Logger {
  error: (obj: unknown, msg: string) => void;
  warn: (obj: unknown, msg: string) => void;
  info: (obj: unknown, msg: string) => void;
}

export interface SlackProcessor {
  start(): NodeJS.Timeout;
}

type SlackMessagePayload = {
  type: "message";
  subtype?: string;
  bot_id?: string;
  channel: string;
  ts: string;
  text: string;
  user?: string;
};

type SlackEventRecord = {
  id: number;
  slack_event_id: string;
  channel_id: string;
  payload: Record<string, unknown>;
};

const GITHUB_PR_LINK =
  /(?:https?:\/\/)?github\.com\/([^\/\s]+)\/([^\/\s]+)\/pull\/(\d+)/g;

export function extractPullRequestLinks(text: string): Array<{
  org: string;
  repo: string;
  number: number;
}> {
  const links: Array<{ org: string; repo: string; number: number }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = GITHUB_PR_LINK.exec(text)) !== null) {
    const key = `${match[1].toLowerCase()}/${match[2].toLowerCase()}/${match[3]}`;
    if (!seen.has(key)) {
      seen.add(key);
      links.push({
        org: match[1],
        repo: match[2],
        number: Number(match[3]),
      });
    }
  }
  return links;
}

export function createSlackProcessor(options: {
  pool: pg.Pool;
  config: QueueConfig;
  github: GithubApi;
  slack: SlackApi;
  reactions: { success: string; failure: string };
  logger: Logger;
}): SlackProcessor {
  const { pool, config, github, slack, reactions, logger } = options;

  async function withTransaction<T>(
    callback: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function resolveInstallationId(org: string): Promise<number> {
    const fromDb = await withTransaction(async (client) => {
      return getInstallationIdForOrganization(client, org);
    });
    if (fromDb !== null) return fromDb;

    logger.info({ org }, "no installation in database; querying GitHub");

    const installations = await github.getInstallations();
    const match = installations.find(
      (inst) => inst.account.login.toLowerCase() === org.toLowerCase(),
    );
    if (!match) {
      throw new Error("no GitHub App installation found for organization");
    }

    logger.info(
      { org, installationId: match.id },
      "discovered GitHub App installation",
    );

    await withTransaction(async (client) => {
      const orgResult = await client.query<{ id: string }>(
        `INSERT INTO organizations (github_id, login)
         VALUES ($1, $2)
         ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login, updated_at = now()
         RETURNING id`,
        [match.account.id, match.account.login],
      );
      const organizationId = Number(orgResult.rows[0].id);

      await client.query(
        `INSERT INTO installations (organization_id, github_installation_id, active)
         VALUES ($1, $2, true)
         ON CONFLICT (github_installation_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true, updated_at = now()`,
        [organizationId, match.id],
      );
    });

    return match.id;
  }

  async function processEvent(record: SlackEventRecord): Promise<void> {
    const payload = record.payload as SlackMessagePayload;

    if (payload.subtype || payload.bot_id) {
      logger.warn(
        { subtype: payload.subtype, bot_id: payload.bot_id },
        "skipped slack event: bot/edited message",
      );
      throw new Error(
        `Skipped: subtype=${payload.subtype ?? "none"}, bot=${payload.bot_id ?? "none"}`,
      );
    }

    if (
      config.slackChannelSet.size > 0 &&
      !config.slackChannelSet.has(payload.channel.toLowerCase())
    ) {
      logger.warn(
        { channel: payload.channel },
        "skipped slack event: channel not in allowlist",
      );
      throw new Error(
        `Skipped: channel ${payload.channel} not in allowlist`,
      );
    }

    const links = extractPullRequestLinks(payload.text);
    if (links.length === 0) {
      throw new Error("Skipped: no GitHub PR links found");
    }

    logger.info(
      { channel: payload.channel, linkCount: links.length },
      "processing slack message for PR links",
    );

    const errors: string[] = [];

    for (const link of links) {
      const fullName = `${link.org.toLowerCase()}/${link.repo.toLowerCase()}`;

      if (link.org.toLowerCase() !== config.organization.toLowerCase()) {
        errors.push(`${fullName}#${link.number}: wrong organization`);
        continue;
      }

      if (
        config.repositorySet.size > 0 &&
        !config.repositorySet.has(fullName)
      ) {
        errors.push(`${fullName}#${link.number}: repository not in allowlist`);
        continue;
      }

      try {
        await processLink(link, payload.channel, payload.ts);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        errors.push(`${fullName}#${link.number}: ${message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join("; "));
    }
  }

  async function processLink(
    link: { org: string; repo: string; number: number },
    channel: string,
    ts: string,
  ): Promise<void> {
    const fullName = `${link.org}/${link.repo}`;

    const installationId = await resolveInstallationId(link.org);

    const repository = await github.getRepository(fullName, installationId);
    const pullRequest = await github.getPullRequest(
      fullName,
      link.number,
      installationId,
    );

    if (pullRequest.draft) {
      throw new Error("draft pull requests are not queued");
    }

    if (pullRequest.state !== "open") {
      throw new Error("pull request is not open");
    }

    // Pre-fetch current state outside the DB transaction
    const [reviews, checkRuns, commitStatuses, workflowRuns] =
      await Promise.all([
        github.getPullRequestReviews(fullName, link.number, installationId),
        github.getCheckRuns(fullName, pullRequest.head.sha, installationId),
        github.getCommitStatuses(
          fullName,
          pullRequest.head.sha,
          installationId,
        ),
        github.getWorkflowRuns(
          fullName,
          pullRequest.head.sha,
          installationId,
        ),
      ]);

    const result = await withTransaction(async (client) => {
      const context = await ensureOrganizationAndRepository(
        client,
        repository,
        link.org,
        installationId,
        config,
      );
      if (!context) {
        throw new Error("repository context rejected by configuration");
      }

      const existingId = await findPullRequest(
        client,
        context.repositoryId,
        link.number,
      );
      if (existingId !== null) {
        const prResult = await client.query<{ state: string }>(
          `SELECT state FROM pull_requests WHERE id = $1`,
          [existingId],
        );
        if (prResult.rows[0]?.state === "open") {
          return { pullRequestId: existingId, isAlreadyTracked: true };
        }
      }

      const pullRequestId = await upsertPullRequest(
        client,
        context.repositoryId,
        pullRequest,
        true,
      );
      await activateQueueEntry(client, context.organizationId, pullRequestId);

      // Hydrate reviews
      for (const review of reviews) {
        await updateReview(client, pullRequestId, {
          action: "submitted",
          review: {
            id: review.id,
            user: { id: review.user.id, login: review.user.login },
            state: review.state,
            commit_id: review.commit_id,
            submitted_at: review.submitted_at,
          },
          pull_request: pullRequest,
          repository,
        });
      }

      // Hydrate check runs
      for (const checkRun of checkRuns) {
        await upsertStatus(client, context.repositoryId, pullRequestId, {
          kind: "check",
          externalId: String(checkRun.id),
          name: checkRun.name,
          headSha: checkRun.head_sha,
          state: checkRun.status,
          conclusion: checkRun.conclusion,
        });
      }

      // Hydrate commit statuses
      for (const status of commitStatuses) {
        await upsertStatus(client, context.repositoryId, pullRequestId, {
          kind: "commit",
          externalId: String(status.id),
          name: status.context,
          headSha: pullRequest.head.sha,
          state: status.state,
          conclusion: status.state,
        });
      }

      // Hydrate workflow runs
      for (const run of workflowRuns) {
        await upsertStatus(client, context.repositoryId, pullRequestId, {
          kind: "workflow",
          externalId: String(run.id),
          name: run.name,
          headSha: run.head_sha,
          state: run.status,
          conclusion: run.conclusion,
        });
      }

      return { pullRequestId, isAlreadyTracked: false };
    });

    await slack.addReaction(channel, ts, reactions.success);

    if (result.isAlreadyTracked) {
      logger.info(
        { pr: `${fullName}#${link.number}`, pullRequestId: result.pullRequestId },
        "PR already tracked; skipped hydration",
      );
    } else {
      logger.info(
        {
          pr: `${fullName}#${link.number}`,
          pullRequestId: result.pullRequestId,
          reviewCount: reviews.length,
          checkRunCount: checkRuns.length,
          statusCount: commitStatuses.length,
          workflowCount: workflowRuns.length,
        },
        "hydrated PR state from GitHub",
      );
    }
  }

  async function claimEvent(): Promise<SlackEventRecord | null> {
    return withTransaction(async (client) => {
      const result = await client.query<SlackEventRecord>(
        `SELECT id, slack_event_id, channel_id, payload FROM slack_events
         WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE slack_events SET status = 'processing', attempts = attempts + 1, error = NULL WHERE id = $1`,
        [row.id],
      );
      return {
        id: Number(row.id),
        slack_event_id: row.slack_event_id,
        channel_id: row.channel_id,
        payload: row.payload,
      };
    });
  }

  async function processRecord(id: number): Promise<void> {
    const result = await pool.query<SlackEventRecord>(
      `SELECT id, slack_event_id, channel_id, payload FROM slack_events WHERE id = $1`,
      [id],
    );
    const record = result.rows[0];
    if (!record) return;

    try {
      await processEvent(record);
      await pool.query(
        `UPDATE slack_events SET status = 'processed', processed_at = now() WHERE id = $1`,
        [id],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `UPDATE slack_events SET status = 'failed', error = $1 WHERE id = $2`,
        [message, id],
      );

      try {
        const payload = record.payload as SlackMessagePayload;
        if (payload.channel && payload.ts) {
          await slack.addReaction(
            payload.channel,
            payload.ts,
            reactions.failure,
          );
        }
      } catch (reactionError) {
        logger.error(
          { err: reactionError, channel: (record.payload as SlackMessagePayload).channel },
          "failed to add failure reaction to slack message",
        );
      }

      throw error;
    }
  }

  function start(): NodeJS.Timeout {
    const timer = setInterval(() => {
      void claimEvent()
        .then((record) => (record ? processRecord(record.id) : undefined))
        .catch((error) => {
          logger.error(
            { err: error },
            "slack processor unhandled error during event processing",
          );
        });
    }, 1_000);
    timer.unref();
    return timer;
  }

  return { start };
}
