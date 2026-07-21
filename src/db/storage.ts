import type pg from "pg";
import { aggregateStatuses, type ReviewState } from "../domain/queue.js";
import type { QueueConfig } from "../config.js";
import type {
  GithubCheckRunPayload,
  GithubCheckSuitePayload,
  GithubPullRequest,
  GithubRepository,
  GithubReviewPayload,
  GithubStatusPayload,
  GithubWorkflowRunPayload,
} from "../github/types.js";

export interface QueueRow {
  position: number;
  ahead: number;
  repository: string;
  number: number;
  title: string;
  url: string;
  author: { login: string; avatarUrl: string | null };
  waitingSince: string;
  headSha: string;
  reviewState: ReviewState;
  statuses: {
    checks: ReturnType<typeof aggregateStatuses>;
    workflows: ReturnType<typeof aggregateStatuses>;
    commits: ReturnType<typeof aggregateStatuses>;
  };
  requestedReviewers: Array<{ login: string; type: string }>;
  requiredReviewers: Array<{ name: string; minimumApprovals: number }>;
}

export async function ensureOrganizationAndRepository(
  client: pg.PoolClient,
  repository: GithubRepository,
  organizationLogin: string,
  installationId: number | undefined,
  config: QueueConfig,
): Promise<{
  organizationId: number;
  repositoryId: number;
  installationId: number | null;
}> {
  const organizationResult = await client.query<{ id: string }>(
    `INSERT INTO organizations (github_id, login)
     VALUES ($1, $2)
     ON CONFLICT (github_id) DO UPDATE SET login = EXCLUDED.login, updated_at = now()
     RETURNING id`,
    [repository.owner.id, organizationLogin],
  );
  const organizationId = Number(organizationResult.rows[0].id);

  let storedInstallationId: number | null = null;
  if (installationId !== undefined) {
    const installationResult = await client.query<{ id: string }>(
      `INSERT INTO installations (organization_id, github_installation_id)
       VALUES ($1, $2)
       ON CONFLICT (github_installation_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true, updated_at = now()
       RETURNING id`,
      [organizationId, installationId],
    );
    storedInstallationId = Number(installationResult.rows[0].id);
  }

  const repositoryResult = await client.query<{ id: string }>(
    `INSERT INTO repositories (organization_id, github_id, full_name, enabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (github_id) DO UPDATE SET full_name = EXCLUDED.full_name, enabled = EXCLUDED.enabled, updated_at = now()
     RETURNING id`,
    [
      organizationId,
      repository.id,
      repository.full_name,
      config.repositorySet.has(repository.full_name.toLowerCase()),
    ],
  );

  return {
    organizationId,
    repositoryId: Number(repositoryResult.rows[0].id),
    installationId: storedInstallationId,
  };
}

export async function upsertPullRequest(
  client: pg.PoolClient,
  repositoryId: number,
  pullRequest: GithubPullRequest,
  markReady = false,
): Promise<number> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO pull_requests (
       repository_id, github_id, number, title, url, author_login, author_avatar_url,
       state, draft, merged, base_branch, head_sha, ready_at, requested_reviewers, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       CASE WHEN $14 = true THEN now() ELSE NULL END, $13, now())
     ON CONFLICT (github_id) DO UPDATE SET
       title = EXCLUDED.title,
       url = EXCLUDED.url,
       author_login = EXCLUDED.author_login,
       author_avatar_url = EXCLUDED.author_avatar_url,
       state = EXCLUDED.state,
       draft = EXCLUDED.draft,
       merged = EXCLUDED.merged,
       base_branch = EXCLUDED.base_branch,
       head_sha = EXCLUDED.head_sha,
       check_status = CASE WHEN pull_requests.head_sha <> EXCLUDED.head_sha THEN 'unknown' ELSE pull_requests.check_status END,
       workflow_status = CASE WHEN pull_requests.head_sha <> EXCLUDED.head_sha THEN 'unknown' ELSE pull_requests.workflow_status END,
       commit_status = CASE WHEN pull_requests.head_sha <> EXCLUDED.head_sha THEN 'unknown' ELSE pull_requests.commit_status END,
       requested_reviewers = EXCLUDED.requested_reviewers,
        ready_at = CASE WHEN $14 = true THEN now() ELSE pull_requests.ready_at END,
       updated_at = now()
     RETURNING id`,
    [
      repositoryId,
      pullRequest.id,
      pullRequest.number,
      pullRequest.title,
      pullRequest.html_url,
      pullRequest.user.login,
      pullRequest.user.avatar_url ?? null,
      pullRequest.state,
      pullRequest.draft,
      pullRequest.merged ?? false,
      pullRequest.base.ref,
      pullRequest.head.sha,
      JSON.stringify(
        (pullRequest.requested_reviewers ?? []).map((reviewer) => ({
          login: reviewer.login,
          type: reviewer.type ?? "User",
        })),
      ),
      markReady,
    ],
  );
  return Number(result.rows[0].id);
}

export async function setRequiredReviewers(
  client: pg.PoolClient,
  pullRequestId: number,
  requiredReviewers: Array<{ name: string; minimumApprovals: number }>,
): Promise<void> {
  await client.query(
    `UPDATE pull_requests SET required_reviewers = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(requiredReviewers), pullRequestId],
  );
}

export async function applyConfiguration(
  client: pg.Pool | pg.PoolClient,
  config: QueueConfig,
): Promise<void> {
  const repositories = [...config.repositorySet];
  const ignoredAuthors = [...config.ignoredAuthorSet];
  await client.query(
    `UPDATE repositories SET enabled = lower(full_name) = ANY($1::text[]), updated_at = now()`,
    [repositories],
  );
  await client.query(
    `UPDATE queue_entries q SET active = false, updated_at = now()
     FROM pull_requests p
     JOIN repositories r ON r.id = p.repository_id
     WHERE q.pull_request_id = p.id
       AND (r.enabled = false OR lower(p.author_login) = ANY($1::text[]))`,
    [ignoredAuthors],
  );
}

async function nextQueueOrder(
  client: pg.PoolClient,
  organizationId: number,
): Promise<number> {
  const result = await client.query<{ queue_sequence: string }>(
    `UPDATE organizations SET queue_sequence = queue_sequence + 1, updated_at = now()
     WHERE id = $1 RETURNING queue_sequence`,
    [organizationId],
  );
  return Number(result.rows[0].queue_sequence);
}

export async function activateQueueEntry(
  client: pg.PoolClient,
  organizationId: number,
  pullRequestId: number,
): Promise<void> {
  const existing = await client.query<{ id: string; active: boolean }>(
    `SELECT id, active FROM queue_entries WHERE pull_request_id = $1 FOR UPDATE`,
    [pullRequestId],
  );
  if (existing.rows[0]?.active) return;
  const order = await nextQueueOrder(client, organizationId);
  await client.query(
    `INSERT INTO queue_entries (organization_id, pull_request_id, queue_order, active)
     VALUES ($1, $2, $3, true)
      ON CONFLICT (pull_request_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, queue_order = EXCLUDED.queue_order, active = true, last_reviewed_sha = NULL, last_requeued_sha = NULL, updated_at = now()`,
    [organizationId, pullRequestId, order],
  );
}

export async function deactivateQueueEntry(
  client: pg.PoolClient,
  pullRequestId: number,
): Promise<void> {
  await client.query(
    `UPDATE queue_entries SET active = false, updated_at = now() WHERE pull_request_id = $1`,
    [pullRequestId],
  );
}

export async function requeueEntry(
  client: pg.PoolClient,
  organizationId: number,
  pullRequestId: number,
  headSha?: string,
): Promise<void> {
  const existing = await client.query<{
    active: boolean;
    queue_order: string;
    last_requeued_sha: string | null;
  }>(
    `SELECT active, queue_order, last_requeued_sha FROM queue_entries WHERE pull_request_id = $1 FOR UPDATE`,
    [pullRequestId],
  );
  if (
    !existing.rows[0]?.active ||
    (headSha && existing.rows[0].last_requeued_sha === headSha)
  )
    return;
  const order = await nextQueueOrder(client, organizationId);
  await client.query(
    `UPDATE queue_entries SET queue_order = $1, last_requeued_sha = COALESCE($2, last_requeued_sha), updated_at = now() WHERE pull_request_id = $3`,
    [order, headSha ?? null, pullRequestId],
  );
}

export async function setLastReviewedSha(
  client: pg.PoolClient,
  pullRequestId: number,
  sha: string,
): Promise<void> {
  await client.query(
    `UPDATE queue_entries SET last_reviewed_sha = $1, updated_at = now() WHERE pull_request_id = $2`,
    [sha, pullRequestId],
  );
}

export async function updateReview(
  client: pg.PoolClient,
  pullRequestId: number,
  payload: GithubReviewPayload,
): Promise<void> {
  const state = payload.review.state.toLowerCase();
  await client.query(
    `INSERT INTO reviews (pull_request_id, github_id, reviewer_login, state, commit_sha, submitted_at, dismissed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (github_id) DO UPDATE SET state = EXCLUDED.state, commit_sha = EXCLUDED.commit_sha, submitted_at = EXCLUDED.submitted_at, dismissed = EXCLUDED.dismissed, updated_at = now()`,
    [
      pullRequestId,
      payload.review.id,
      payload.review.user.login,
      state,
      payload.review.commit_id,
      payload.review.submitted_at,
      state === "dismissed",
    ],
  );
  if (
    payload.review.submitted_at &&
    ["approved", "changes_requested", "commented"].includes(state)
  ) {
    await setLastReviewedSha(client, pullRequestId, payload.review.commit_id);
  }

  const latest = await client.query<{ state: string }>(
    `SELECT state FROM (
       SELECT DISTINCT ON (reviewer_login) state, submitted_at
       FROM reviews WHERE pull_request_id = $1 ORDER BY reviewer_login, submitted_at DESC NULLS LAST
     ) latest_reviews ORDER BY submitted_at DESC NULLS LAST`,
    [pullRequestId],
  );
  const reviewState: ReviewState = latest.rows.some(
    (row) => row.state === "changes_requested",
  )
    ? "changes_requested"
    : latest.rows.some((row) => row.state === "approved")
      ? "approved"
      : latest.rows.some((row) => row.state === "commented")
        ? "commented"
        : "pending";
  await client.query(
    `UPDATE pull_requests SET review_state = $1, updated_at = now() WHERE id = $2`,
    [reviewState, pullRequestId],
  );
}

export async function upsertStatus(
  client: pg.PoolClient,
  repositoryId: number,
  pullRequestId: number,
  status: {
    kind: "check" | "workflow" | "commit";
    externalId: string;
    name: string;
    headSha: string;
    state: string;
    conclusion?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO status_snapshots (repository_id, pull_request_id, kind, external_id, name, head_sha, state, conclusion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (repository_id, kind, external_id) DO UPDATE SET pull_request_id = EXCLUDED.pull_request_id, name = EXCLUDED.name, head_sha = EXCLUDED.head_sha, state = EXCLUDED.state, conclusion = EXCLUDED.conclusion, updated_at = now()`,
    [
      repositoryId,
      pullRequestId,
      status.kind,
      status.externalId,
      status.name,
      status.headSha,
      status.state,
      status.conclusion ?? null,
    ],
  );
  await refreshAggregateStatus(client, pullRequestId, status.kind);
}

async function refreshAggregateStatus(
  client: pg.PoolClient,
  pullRequestId: number,
  kind: "check" | "workflow" | "commit",
): Promise<void> {
  const result = await client.query<{
    state: string;
    conclusion: string | null;
  }>(
    `SELECT DISTINCT ON (s.name) s.state, s.conclusion
      FROM status_snapshots s
      JOIN pull_requests p ON p.id = s.pull_request_id AND p.head_sha = s.head_sha
      WHERE s.pull_request_id = $1 AND s.kind = $2
      ORDER BY s.name, s.updated_at DESC`,
    [pullRequestId, kind],
  );
  const aggregate = aggregateStatuses(result.rows);
  const column =
    kind === "check"
      ? "check_status"
      : kind === "workflow"
        ? "workflow_status"
        : "commit_status";
  await client.query(
    `UPDATE pull_requests SET ${column} = $1, updated_at = now() WHERE id = $2`,
    [aggregate, pullRequestId],
  );
}

export async function findPullRequestsByHead(
  client: pg.PoolClient,
  repositoryId: number,
  headSha: string,
): Promise<Array<{ id: number; number: number }>> {
  const result = await client.query<{ id: string; number: number }>(
    `SELECT id, number FROM pull_requests WHERE repository_id = $1 AND head_sha = $2 AND state = 'open'`,
    [repositoryId, headSha],
  );
  return result.rows.map((row) => ({ id: Number(row.id), number: row.number }));
}

export async function getQueue(
  client: pg.Pool | pg.PoolClient,
): Promise<QueueRow[]> {
  const result = await client.query<{
    position: string;
    ahead: string;
    repository: string;
    number: number;
    title: string;
    url: string;
    author_login: string;
    author_avatar_url: string | null;
    ready_at: string;
    head_sha: string;
    review_state: ReviewState;
    check_status: ReturnType<typeof aggregateStatuses>;
    workflow_status: ReturnType<typeof aggregateStatuses>;
    commit_status: ReturnType<typeof aggregateStatuses>;
    requested_reviewers: Array<{ login: string; type: string }>;
    required_reviewers: Array<{ name: string; minimumApprovals: number }>;
  }>(
    `SELECT
       ROW_NUMBER() OVER (ORDER BY q.queue_order) AS position,
       ROW_NUMBER() OVER (ORDER BY q.queue_order) - 1 AS ahead,
       r.full_name AS repository, p.number, p.title, p.url, p.author_login, p.author_avatar_url,
       p.ready_at, p.head_sha, p.review_state, p.check_status, p.workflow_status, p.commit_status,
       p.requested_reviewers, p.required_reviewers
     FROM queue_entries q
     JOIN pull_requests p ON p.id = q.pull_request_id
     JOIN repositories r ON r.id = p.repository_id
     WHERE q.active = true AND p.state = 'open' AND p.draft = false AND r.enabled = true
     ORDER BY q.queue_order`,
  );
  return result.rows.map((row) => ({
    position: Number(row.position),
    ahead: Number(row.ahead),
    repository: row.repository,
    number: row.number,
    title: row.title,
    url: row.url,
    author: { login: row.author_login, avatarUrl: row.author_avatar_url },
    waitingSince: row.ready_at,
    headSha: row.head_sha,
    reviewState: row.review_state,
    statuses: {
      checks: row.check_status,
      workflows: row.workflow_status,
      commits: row.commit_status,
    },
    requestedReviewers: row.requested_reviewers ?? [],
    requiredReviewers: row.required_reviewers ?? [],
  }));
}

export async function findPullRequest(
  client: pg.PoolClient,
  repositoryId: number,
  number: number,
): Promise<number | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM pull_requests WHERE repository_id = $1 AND number = $2`,
    [repositoryId, number],
  );
  return result.rows[0] ? Number(result.rows[0].id) : null;
}
