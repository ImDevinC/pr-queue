import { useEffect, useState } from "react";

type Status = "passing" | "failing" | "pending" | "unknown";
type ReviewState = "pending" | "approved" | "changes_requested" | "commented";

interface QueueEntry {
  position: number;
  ahead: number;
  repository: string;
  number: number;
  title: string;
  url: string;
  author: { login: string; avatarUrl: string | null };
  waitingSince: string;
  reviewState: ReviewState;
  statuses: { checks: Status; workflows: Status; commits: Status };
  requestedReviewers: Array<{ login: string; type: string }>;
  requiredReviewers: Array<{ name: string; minimumApprovals: number }>;
}

interface QueueResponse {
  updatedAt: string;
  entries: QueueEntry[];
}

export function App() {
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/queue", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok)
          throw new Error(`Queue unavailable (${response.status})`);
        const next = (await response.json()) as QueueResponse;
        if (!cancelled) {
          setQueue(next);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Queue unavailable",
          );
      }
    };
    void load();
    const interval = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const count = queue?.entries.length ?? 0;

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Review operations</p>
          <h1>PR Queue</h1>
          <p className="lede">
            A clear line of sight from ready for review to merged.
          </p>
        </div>
        <div
          className="queue-count"
          aria-label={`${count} pull requests waiting`}
        >
          <strong>{count}</strong>
          <span>{count === 1 ? "PR waiting" : "PRs waiting"}</span>
        </div>
      </header>

      <section className="status-bar" aria-live="polite">
        <span className="live-dot" />
        <span>Live queue</span>
        <span className="status-divider" />
        <span>
          {queue ? `Updated ${formatTime(queue.updatedAt)}` : "Connecting…"}
        </span>
      </section>

      {error && (
        <div className="notice error">{error}. Retrying automatically.</div>
      )}

      {!queue && !error && (
        <div className="notice">Loading the review queue…</div>
      )}

      {queue && queue.entries.length === 0 && (
        <section className="empty-state">
          <div className="empty-mark">✓</div>
          <h2>Nothing waiting</h2>
          <p>
            The queue is clear. This is either excellent process or suspicious
            timing.
          </p>
        </section>
      )}

      {queue && queue.entries.length > 0 && (
        <section
          className="queue"
          aria-label="Pull requests waiting for review"
        >
          {queue.entries.map((entry) => (
            <PullRequestCard
              entry={entry}
              key={`${entry.repository}-${entry.number}`}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function PullRequestCard({ entry }: { entry: QueueEntry }) {
  return (
    <article className="pr-card">
      <div className="rank" aria-label={`${entry.ahead} pull requests ahead`}>
        <span className="rank-number">
          {String(entry.position).padStart(2, "0")}
        </span>
        <span className="rank-label">
          {entry.ahead === 0 ? "up next" : `${entry.ahead} ahead`}
        </span>
      </div>
      <div className="pr-main">
        <div className="pr-heading">
          <div className="repo-line">
            <span className="repo-name">{entry.repository}</span>
            <span className="pr-number">#{entry.number}</span>
          </div>
          <a
            className="github-link"
            href={entry.url}
            target="_blank"
            rel="noreferrer"
          >
            Open on GitHub <span aria-hidden="true">↗</span>
          </a>
        </div>
        <h2>{entry.title}</h2>
        <div className="meta-row">
          <span className="author">
            {entry.author.avatarUrl ? (
              <img src={entry.author.avatarUrl} alt="" />
            ) : (
              <span className="avatar-fallback">
                {entry.author.login.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span>{entry.author.login}</span>
          </span>
          <span className="waiting">
            Waiting {formatWaiting(entry.waitingSince)}
          </span>
        </div>
        <div className="details-grid">
          <div>
            <span className="detail-label">Review</span>
            <StatusPill
              value={entry.reviewState}
              label={formatReview(entry.reviewState)}
            />
          </div>
          <div>
            <span className="detail-label">Checks</span>
            <StatusPill
              value={entry.statuses.checks}
              label={formatStatus(entry.statuses.checks)}
            />
          </div>
          <div>
            <span className="detail-label">Actions</span>
            <StatusPill
              value={entry.statuses.workflows}
              label={formatStatus(entry.statuses.workflows)}
            />
          </div>
          <div>
            <span className="detail-label">Statuses</span>
            <StatusPill
              value={entry.statuses.commits}
              label={formatStatus(entry.statuses.commits)}
            />
          </div>
        </div>
        <div className="reviewers">
          <div>
            <span className="detail-label">Requested reviewers</span>
            <div className="tag-list">
              {entry.requestedReviewers.length > 0 ? (
                entry.requestedReviewers.map((reviewer) => (
                  <span
                    className="tag"
                    key={`${reviewer.type}-${reviewer.login}`}
                  >
                    {reviewer.type === "Team"
                      ? `@${reviewer.login} team`
                      : `@${reviewer.login}`}
                  </span>
                ))
              ) : (
                <span className="muted">None assigned</span>
              )}
            </div>
          </div>
          {entry.requiredReviewers.length > 0 && (
            <div>
              <span className="detail-label">Required by branch rules</span>
              <div className="tag-list">
                {entry.requiredReviewers.map((reviewer, index) => (
                  <span
                    className="tag required"
                    key={`${reviewer.name}-${index}`}
                  >
                    {reviewer.name} · {reviewer.minimumApprovals}{" "}
                    {reviewer.minimumApprovals === 1 ? "approval" : "approvals"}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function StatusPill({ value, label }: { value: string; label: string }) {
  return (
    <span className={`status-pill ${value}`}>
      <span className="status-icon" aria-hidden="true" />
      {label}
    </span>
  );
}

function formatStatus(status: Status): string {
  return status === "unknown"
    ? "No signal"
    : status[0].toUpperCase() + status.slice(1);
}

function formatReview(status: ReviewState): string {
  return status === "changes_requested"
    ? "Changes requested"
    : status[0].toUpperCase() + status.slice(1);
}

function formatWaiting(value: string): string {
  const milliseconds = Math.max(0, Date.now() - Date.parse(value));
  const hours = Math.floor(milliseconds / 3_600_000);
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
