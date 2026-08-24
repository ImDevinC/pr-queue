import type pg from "pg";
import type { GithubApi } from "./api.js";
import {
  getActiveQueuedPullRequests,
  getInstallationIdForOrganization,
  upsertStatus,
} from "../db/storage.js";

export interface StatusPoller {
  start(): NodeJS.Timeout;
  stop(): void;
}

interface PollerLogger {
  error(obj: Record<string, unknown>, msg: string): void;
  info(obj: Record<string, unknown>, msg: string): void;
}

const POLL_INTERVAL_MS = 60_000;

export function createStatusPoller(options: {
  pool: pg.Pool;
  github: GithubApi;
  logger: PollerLogger;
}): StatusPoller {
  const { pool, github, logger } = options;

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

  async function refreshPullRequestStatuses(): Promise<void> {
    const queued = await getActiveQueuedPullRequests(pool);
    if (queued.length === 0) return;

    const byOrg = new Map<string, typeof queued>();
    for (const pr of queued) {
      const list = byOrg.get(pr.organizationLogin) ?? [];
      list.push(pr);
      byOrg.set(pr.organizationLogin, list);
    }

    for (const [orgLogin, prs] of byOrg) {
      const installationId = await withTransaction((client) =>
        getInstallationIdForOrganization(client, orgLogin),
      );
      if (installationId === null) {
        logger.info(
          { org: orgLogin },
          "no active GitHub installation, skipping status sync",
        );
        continue;
      }

      for (const pr of prs) {
        try {
          const current = await github.getPullRequest(
            pr.repository,
            pr.number,
            installationId,
          );
          if (current.state !== "open" || current.draft || current.merged) {
            continue;
          }
          const headSha = current.head.sha;

          const [checkRuns, commitStatuses, workflowRuns] = await Promise.all([
            github.getCheckRuns(pr.repository, headSha, installationId),
            github.getCommitStatuses(pr.repository, headSha, installationId),
            github.getWorkflowRuns(pr.repository, headSha, installationId),
          ]);

          await withTransaction(async (client) => {
            for (const run of checkRuns) {
              if (run.head_sha !== headSha) continue;
              await upsertStatus(client, pr.repositoryId, pr.pullRequestId, {
                kind: "check",
                externalId: String(run.id),
                name: run.name,
                headSha,
                state: run.status,
                conclusion: run.conclusion,
              });
            }
            for (const status of commitStatuses) {
              await upsertStatus(client, pr.repositoryId, pr.pullRequestId, {
                kind: "commit",
                externalId: String(status.id),
                name: status.context,
                headSha,
                state: status.state,
                conclusion: status.state,
              });
            }
            for (const run of workflowRuns) {
              if (run.head_sha !== headSha) continue;
              await upsertStatus(client, pr.repositoryId, pr.pullRequestId, {
                kind: "workflow",
                externalId: String(run.id),
                name: run.name,
                headSha,
                state: run.status,
                conclusion: run.conclusion,
              });
            }
          });
        } catch (error) {
          logger.error(
            {
              repo: pr.repository,
              number: pr.number,
              error: error instanceof Error ? error.message : String(error),
            },
            "failed to sync PR statuses",
          );
        }
      }
    }
  }

  let running = false;
  let timer: NodeJS.Timeout | null = null;

  function start(): NodeJS.Timeout {
    timer = setInterval(() => {
      if (running) return;
      running = true;
      void refreshPullRequestStatuses()
        .catch((error) => {
          logger.error(
            {
              error: error instanceof Error ? error.message : String(error),
            },
            "status poller failed",
          );
        })
        .finally(() => {
          running = false;
        });
    }, POLL_INTERVAL_MS);
    timer.unref();
    return timer;
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop };
}
