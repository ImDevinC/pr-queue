import type pg from "pg";
import type { QueueConfig } from "../config.js";
import {
  activateQueueEntry,
  deactivateQueueEntry,
  ensureOrganizationAndRepository,
  findPullRequest,
  findPullRequestsByHead,
  requeueEntry,
  setRequiredReviewers,
  setLastReviewedSha,
  updateReview,
  upsertPullRequest,
  upsertStatus,
} from "../db/storage.js";
import type { GithubApi } from "./api.js";
import type {
  GithubCheckRunPayload,
  GithubCheckSuitePayload,
  GithubPullRequestPayload,
  GithubRepository,
  GithubReviewPayload,
  GithubStatusPayload,
  GithubWorkflowRunPayload,
} from "./types.js";

export interface WebhookProcessor {
  processDelivery(deliveryId: number): Promise<void>;
  start(): NodeJS.Timeout;
}

type JsonObject = Record<string, unknown>;

export function shouldActivatePullRequest(
  action: string,
  draft: boolean,
): boolean {
  return !draft && ["opened", "ready_for_review", "reopened"].includes(action);
}

export function createWebhookProcessor(options: {
  pool: pg.Pool;
  config: QueueConfig;
  github: GithubApi;
}): WebhookProcessor {
  const { pool, config, github } = options;

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

  async function repositoryContext(
    client: pg.PoolClient,
    repository: GithubRepository,
    installationId?: number,
  ) {
    if (
      repository.owner.login.toLowerCase() !== config.organization.toLowerCase()
    )
      return null;
    if (!config.repositorySet.has(repository.full_name.toLowerCase()))
      return null;
    return ensureOrganizationAndRepository(
      client,
      repository,
      repository.owner.login,
      installationId,
      config,
    );
  }

  async function refreshRequiredReviewers(
    repository: string,
    branch: string,
    installationId: number | undefined,
    pullRequestId: number,
  ): Promise<void> {
    if (!installationId) return;
    try {
      const raw = (await github.getBranchRules(
        repository,
        branch,
        installationId,
      )) as unknown;
      const required = extractRequiredReviewers(raw);
      await withTransaction((client) =>
        setRequiredReviewers(client, pullRequestId, required),
      );
    } catch {
      // Branch rules are optional for processing. The queue remains usable if GitHub denies this read.
    }
  }

  async function processPullRequest(
    payload: GithubPullRequestPayload,
  ): Promise<void> {
    const pullRequest = payload.pull_request;
    const ignored = config.ignoredAuthorSet.has(
      pullRequest.user.login.toLowerCase(),
    );
    const ready = shouldActivatePullRequest(payload.action, pullRequest.draft);

    const pullRequestId = await withTransaction(async (client) => {
      const context = await repositoryContext(
        client,
        payload.repository,
        payload.installation?.id,
      );
      if (!context) return null;
      const id = await upsertPullRequest(
        client,
        context.repositoryId,
        pullRequest,
        ready,
      );

      if (
        ignored ||
        payload.action === "closed" ||
        pullRequest.merged ||
        payload.action === "converted_to_draft" ||
        pullRequest.draft
      ) {
        await deactivateQueueEntry(client, id);
      } else if (ready) {
        await activateQueueEntry(client, context.organizationId, id);
      } else if (payload.action === "review_requested") {
        await requeueEntry(client, context.organizationId, id);
      } else if (payload.action === "synchronize") {
        const queue = await client.query<{
          active: boolean;
          last_reviewed_sha: string | null;
          last_requeued_sha: string | null;
        }>(
          `SELECT active, last_reviewed_sha, last_requeued_sha FROM queue_entries WHERE pull_request_id = $1 FOR UPDATE`,
          [id],
        );
        const current = queue.rows[0];
        if (
          current?.active &&
          current.last_reviewed_sha &&
          current.last_reviewed_sha !== pullRequest.head.sha &&
          current.last_requeued_sha !== pullRequest.head.sha
        ) {
          await requeueEntry(
            client,
            context.organizationId,
            id,
            pullRequest.head.sha,
          );
        }
      }
      return id;
    });

    if (pullRequestId) {
      await refreshRequiredReviewers(
        payload.repository.full_name,
        pullRequest.base.ref,
        payload.installation?.id,
        pullRequestId,
      );
    }
  }

  async function processReview(payload: GithubReviewPayload): Promise<void> {
    await withTransaction(async (client) => {
      const context = await repositoryContext(
        client,
        payload.repository,
        payload.installation?.id,
      );
      if (!context) return;
      const pullRequestId = await upsertPullRequest(
        client,
        context.repositoryId,
        payload.pull_request,
      );
      await updateReview(client, pullRequestId, payload);
      if (payload.action === "submitted" && payload.review.submitted_at) {
        await setLastReviewedSha(
          client,
          pullRequestId,
          payload.review.commit_id,
        );
      }
    });
  }

  async function processCheckRun(
    payload: GithubCheckRunPayload,
  ): Promise<void> {
    await processStatusEvent(
      payload.repository,
      payload.check_run.head_sha,
      "check",
      String(payload.check_run.id),
      payload.check_run.name,
      payload.check_run.status,
      payload.check_run.conclusion,
      payload.installation?.id,
      payload.check_run.pull_requests?.map((pullRequest) => pullRequest.number),
    );
  }

  async function processCheckSuite(
    payload: GithubCheckSuitePayload,
  ): Promise<void> {
    await processStatusEvent(
      payload.repository,
      payload.check_suite.head_sha,
      "check",
      `suite:${payload.check_suite.id}`,
      "Check suite",
      payload.check_suite.status,
      payload.check_suite.conclusion,
      payload.installation?.id,
      payload.check_suite.pull_requests?.map(
        (pullRequest) => pullRequest.number,
      ),
    );
  }

  async function processWorkflowRun(
    payload: GithubWorkflowRunPayload,
  ): Promise<void> {
    await processStatusEvent(
      payload.repository,
      payload.workflow_run.head_sha,
      "workflow",
      String(payload.workflow_run.id),
      "GitHub Actions",
      payload.workflow_run.status,
      payload.workflow_run.conclusion,
      payload.installation?.id,
      payload.workflow_run.pull_requests?.map(
        (pullRequest) => pullRequest.number,
      ),
    );
  }

  async function processCommitStatus(
    payload: GithubStatusPayload,
  ): Promise<void> {
    await processStatusEvent(
      payload.repository,
      payload.sha,
      "commit",
      payload.context ?? "default",
      payload.context ?? "Commit status",
      payload.state,
      payload.state,
      payload.installation?.id,
    );
  }

  async function processStatusEvent(
    repository: GithubRepository,
    headSha: string,
    kind: "check" | "workflow" | "commit",
    externalId: string,
    name: string,
    state: string,
    conclusion: string | null | undefined,
    installationId: number | undefined,
    pullRequestNumbers?: number[],
  ): Promise<void> {
    await withTransaction(async (client) => {
      const context = await repositoryContext(
        client,
        repository,
        installationId,
      );
      if (!context) return;
      const pullRequests: Array<{ id: number | null; number: number }> =
        pullRequestNumbers?.length
          ? []
          : await findPullRequestsByHead(client, context.repositoryId, headSha);
      if (pullRequestNumbers?.length) {
        for (const number of pullRequestNumbers) {
          const pullRequestId = await findPullRequest(
            client,
            context.repositoryId,
            number,
          );
          if (pullRequestId === null) continue;
          const current = await client.query<{ head_sha: string }>(
            `SELECT head_sha FROM pull_requests WHERE id = $1`,
            [pullRequestId],
          );
          if (current.rows[0]?.head_sha === headSha)
            pullRequests.push({ id: pullRequestId, number });
        }
      }
      for (const pullRequest of pullRequests) {
        if (pullRequest.id === null || pullRequest.id === undefined) continue;
        await upsertStatus(client, context.repositoryId, pullRequest.id, {
          kind,
          externalId,
          name,
          headSha,
          state,
          conclusion,
        });
      }
    });
  }

  async function processPayload(
    eventName: string,
    payload: JsonObject,
  ): Promise<void> {
    switch (eventName) {
      case "pull_request":
        await processPullRequest(
          payload as unknown as GithubPullRequestPayload,
        );
        return;
      case "pull_request_review":
        await processReview(payload as unknown as GithubReviewPayload);
        return;
      case "check_run":
        await processCheckRun(payload as unknown as GithubCheckRunPayload);
        return;
      case "check_suite":
        await processCheckSuite(payload as unknown as GithubCheckSuitePayload);
        return;
      case "workflow_run":
        await processWorkflowRun(
          payload as unknown as GithubWorkflowRunPayload,
        );
        return;
      case "status":
        await processCommitStatus(payload as unknown as GithubStatusPayload);
        return;
      default:
        return;
    }
  }

  async function claimDelivery(): Promise<{
    id: number;
    eventName: string;
    payload: JsonObject;
  } | null> {
    return withTransaction(async (client) => {
      const result = await client.query<{
        id: string;
        event_name: string;
        payload: JsonObject;
      }>(
        `SELECT id, event_name, payload FROM webhook_deliveries
         WHERE status IN ('pending', 'failed') AND attempts < 5
         ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        `UPDATE webhook_deliveries SET status = 'processing', attempts = attempts + 1, error = NULL WHERE id = $1`,
        [row.id],
      );
      return {
        id: Number(row.id),
        eventName: row.event_name,
        payload: row.payload,
      };
    });
  }

  async function processDelivery(deliveryId: number): Promise<void> {
    const result = await pool.query<{
      event_name: string;
      payload: JsonObject;
    }>(`SELECT event_name, payload FROM webhook_deliveries WHERE id = $1`, [
      deliveryId,
    ]);
    const delivery = result.rows[0];
    if (!delivery) return;
    try {
      await processPayload(delivery.event_name, delivery.payload);
      await pool.query(
        `UPDATE webhook_deliveries SET status = 'processed', processed_at = now() WHERE id = $1`,
        [deliveryId],
      );
    } catch (error) {
      await pool.query(
        `UPDATE webhook_deliveries SET status = 'failed', error = $1 WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), deliveryId],
      );
      throw error;
    }
  }

  function start(): NodeJS.Timeout {
    const timer = setInterval(() => {
      void claimDelivery()
        .then((delivery) =>
          delivery ? processDelivery(delivery.id) : undefined,
        )
        .catch(() => undefined);
    }, 1_000);
    timer.unref();
    return timer;
  }

  return { processDelivery, start };
}

function extractRequiredReviewers(
  raw: unknown,
): Array<{ name: string; minimumApprovals: number }> {
  if (!Array.isArray(raw)) return [];
  const required: Array<{ name: string; minimumApprovals: number }> = [];
  for (const rule of raw) {
    if (!isObject(rule)) continue;
    if (rule.type === "required_status_checks") continue;
    const parameters = isObject(rule.parameters) ? rule.parameters : {};
    const count =
      typeof parameters.required_approving_review_count === "number"
        ? parameters.required_approving_review_count
        : 0;
    if (count > 0)
      required.push({ name: "Required approvals", minimumApprovals: count });
    if (parameters.require_code_owner_review === true)
      required.push({ name: "Code owner review", minimumApprovals: 1 });
    const reviewers = Array.isArray(parameters.required_reviewers)
      ? parameters.required_reviewers
      : [];
    for (const reviewer of reviewers) {
      if (!isObject(reviewer) || !isObject(reviewer.reviewer)) continue;
      const name =
        typeof reviewer.reviewer.name === "string"
          ? reviewer.reviewer.name
          : `Team ${String(reviewer.reviewer.id ?? "")}`;
      const minimumApprovals =
        typeof reviewer.minimum_approvals === "number"
          ? reviewer.minimum_approvals
          : 1;
      required.push({ name, minimumApprovals });
    }
  }
  return required;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}
