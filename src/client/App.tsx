import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Avatar from "@mui/material/Avatar";
import Divider from "@mui/material/Divider";
import Alert from "@mui/material/Alert";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CircleIcon from "@mui/icons-material/Circle";

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

const MUTE_STORAGE_KEY = "pr-queue-muted";

function playNotificationSound() {
  try {
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(523.25, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // ignore audio errors
  }
}

function repositoryMatches(filter: string, repository: string): boolean {
  const trimmed = filter.trim();
  if (!trimmed) return true;
  const pattern = trimmed
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(pattern, "i").test(repository);
}

export function App() {
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const previousIdsRef = useRef<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

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
          const previousIds = previousIdsRef.current;
          const currentIds = new Set(
            next.entries.map((e) => `${e.repository}-${e.number}`),
          );
          if (previousIds.size > 0) {
            for (const entry of next.entries) {
              const id = `${entry.repository}-${entry.number}`;
              if (!previousIds.has(id)) {
                if (!muted) playNotificationSound();
                break;
              }
            }
          }
          previousIdsRef.current = currentIds;
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
  }, [muted]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, String(next));
    } catch {
      // ignore storage errors
    }
    if (!next) {
      playNotificationSound();
    }
  };

  const allEntries = queue?.entries ?? [];
  const filteredEntries = allEntries.filter((entry) =>
    repositoryMatches(filter, entry.repository),
  );
  const totalCount = allEntries.length;
  const visibleCount = filteredEntries.length;
  const isFiltering = filter.trim().length > 0;

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 5, md: 9 }, px: { xs: 2, md: 3 } }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 3.5,
          pb: 5.25,
          flexDirection: { xs: "column", md: "row" },
          alignItemsStart: { xs: "flex-start", md: "flex-end" },
        }}
      >
        <Box>
          <Typography variant="overline" color="primary" sx={{ mb: 2, display: "block" }}>
            Review operations
          </Typography>
          <Typography variant="h1" sx={{ mb: 1.75 }}>
            PR Queue
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 440 }}>
            A clear line of sight from ready for review to merged.
          </Typography>
        </Box>
        <Box
          sx={{
            minWidth: 140,
            p: 2.25,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 3.5,
            bgcolor: "background.paper",
          }}
          aria-label={`${visibleCount} pull requests waiting`}
        >
          <Typography
            variant="h3"
            color="primary"
            sx={{
              fontSize: 43,
              lineHeight: 1,
              letterSpacing: "-0.07em",
              fontWeight: 700,
            }}
          >
            {visibleCount}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, display: "block" }}
          >
            {isFiltering
              ? `of ${totalCount} ${totalCount === 1 ? "PR" : "PRs"}`
              : visibleCount === 1
                ? "PR waiting"
                : "PRs waiting"}
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          py: 1.625,
          borderTop: "1px solid",
          borderBottom: "1px solid",
          borderColor: "divider",
          color: "text.secondary",
          fontFamily: '"DM Mono", monospace',
          fontSize: 12,
        }}
        aria-live="polite"
      >
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            bgcolor: "primary.main",
            boxShadow: (theme) => `0 0 0 4px ${theme.palette.primary.main}1f`,
          }}
        />
        <span>Live queue</span>
        <Divider
          orientation="vertical"
          flexItem
          sx={{ mx: 0.375, bgcolor: "#3a424e", width: 1 }}
        />
        <span>
          {queue ? `Updated ${formatTime(queue.updatedAt)}` : "Connecting…"}
        </span>
        <Divider
          orientation="vertical"
          flexItem
          sx={{ mx: 0.375, bgcolor: "#3a424e", width: 1 }}
        />
        <Button
          variant="outlined"
          size="small"
          onClick={toggleMute}
          aria-label={muted ? "Unmute notifications" : "Mute notifications"}
          title={muted ? "Unmute notifications" : "Mute notifications"}
          startIcon={muted ? <VolumeOffIcon sx={{ fontSize: 14 }} /> : <VolumeUpIcon sx={{ fontSize: 14 }} />}
          sx={{
            borderColor: "divider",
            color: "text.secondary",
            bgcolor: "background.paper",
            fontSize: 12,
            py: 0.5,
            px: 1.25,
            "&:hover": { bgcolor: "#1e232b" },
          }}
        >
          {muted ? "Muted" : "Sound on"}
        </Button>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{
            mt: 3.25,
            borderColor: "#73404a",
            color: "#ffb2ae",
            bgcolor: "#171b22",
            "& .MuiAlert-icon": { color: "#ff918b" },
          }}
        >
          {error}. Retrying automatically.
        </Alert>
      )}

      {!queue && !error && (
        <Alert severity="info" sx={{ mt: 3.25 }}>
          Loading the review queue…
        </Alert>
      )}

      {queue && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            mt: 2.25,
            p: 2,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 3,
            bgcolor: "background.paper",
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            Filter by repository
          </Typography>
          <TextField
            id="repo-filter"
            size="small"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="e.g. terra or ImDevinC/*"
            aria-describedby="repo-filter-hint"
            sx={{ flex: 1, minWidth: 0 }}
          />
          <Typography
            id="repo-filter-hint"
            variant="caption"
            color="text.secondary"
            sx={{ flexShrink: 0, opacity: 0.5 }}
          >
            Use * as wildcard
          </Typography>
        </Box>
      )}

      {queue && filteredEntries.length === 0 && (
        <Box
          sx={{
            mt: 2.75,
            p: 10,
            border: "1px dashed",
            borderColor: "#39434f",
            borderRadius: 3.5,
            textAlign: "center",
            bgcolor: "#15191f",
          }}
        >
          <Box
            sx={{
              display: "grid",
              placeItems: "center",
              width: 48,
              height: 48,
              mx: "auto",
              mb: 2.25,
              borderRadius: "50%",
              bgcolor: "primary.main",
              color: "background.default",
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            ✓
          </Box>
          <Typography variant="h5" sx={{ mb: 1, letterSpacing: "-0.04em" }}>
            {isFiltering ? "No matching pull requests" : "Nothing waiting"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isFiltering
              ? "Try adjusting your filter pattern."
              : "The queue is clear. This is either excellent process or suspicious timing."}
          </Typography>
        </Box>
      )}

      {queue && filteredEntries.length > 0 && (
        <Box
          component="section"
          aria-label="Pull requests waiting for review"
          sx={{ display: "grid", gap: 1.75, mt: 2.75 }}
        >
          {filteredEntries.map((entry) => (
            <PullRequestCard
              entry={entry}
              key={`${entry.repository}-${entry.number}`}
            />
          ))}
        </Box>
      )}
    </Container>
  );
}

function PullRequestCard({ entry }: { entry: QueueEntry }) {
  return (
    <Card>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "112px 1fr" },
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "row", sm: "column" },
            justifyContent: { xs: "flex-start", sm: "center" },
            alignItems: "center",
            gap: { xs: 1.5, sm: 1.25 },
            p: { xs: "12px 18px", sm: "22px 10px" },
            borderRight: { xs: 0, sm: "1px solid" },
            borderBottom: { xs: "1px solid", sm: 0 },
            borderColor: "divider",
            bgcolor: "#14181e",
          }}
          aria-label={`${entry.ahead} pull requests ahead`}
        >
          <Typography
            sx={{
              color: "text.primary",
              fontFamily: '"DM Mono", monospace',
              fontWeight: 500,
              fontSize: 29,
              letterSpacing: "-0.08em",
            }}
          >
            {String(entry.position).padStart(2, "0")}
          </Typography>
          <Typography
            variant="caption"
            color="primary"
            sx={{ fontSize: 9, textAlign: "center" }}
          >
            {entry.ahead === 0 ? "up next" : `${entry.ahead} ahead`}
          </Typography>
        </Box>

        <CardContent sx={{ minWidth: 0, p: { xs: "19px 18px 21px", sm: "23px 26px 25px" } }}>
          <Box
            sx={{
              display: "flex",
              alignItems: { xs: "flex-start", sm: "center" },
              justifyContent: "space-between",
              gap: 2.25,
              flexDirection: { xs: "column", sm: "row" },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, fontFamily: '"DM Mono", monospace', fontSize: 12 }}>
              <Typography
                component="span"
                sx={{
                  overflow: "hidden",
                  color: "primary.main",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: '"DM Mono", monospace',
                  fontSize: 12,
                }}
              >
                {entry.repository}
              </Typography>
              <Typography
                component="span"
                color="text.secondary"
                sx={{ fontFamily: '"DM Mono", monospace', fontSize: 12 }}
              >
                #{entry.number}
              </Typography>
            </Box>
            <Typography
              component="a"
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              sx={{
                flexShrink: 0,
                color: "text.secondary",
                fontFamily: '"DM Mono", monospace',
                fontSize: 11,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                "&:hover": { color: "text.primary" },
              }}
            >
              Open on GitHub <OpenInNewIcon sx={{ fontSize: 12 }} />
            </Typography>
          </Box>

          <Typography
            variant="h2"
            sx={{
              mt: 1.625,
              mb: 1.75,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: { xs: "normal", sm: "nowrap" },
            }}
          >
            {entry.title}
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 2.125, fontSize: 12, color: "text.secondary" }}>
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, color: "#d0d4da" }}>
              {entry.author.avatarUrl ? (
                <Avatar src={entry.author.avatarUrl} alt="" sx={{ width: 22, height: 22 }} />
              ) : (
                <Avatar sx={{ width: 22, height: 22 }}>
                  {entry.author.login.slice(0, 1).toUpperCase()}
                </Avatar>
              )}
              <span>{entry.author.login}</span>
            </Box>
            <Box component="span" sx={{ color: "#7d8794" }}>
              Waiting {formatWaiting(entry.waitingSince)}
            </Box>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" },
              gap: 1.75,
              mt: 3.125,
              py: 2,
              borderTop: "1px solid",
              borderBottom: "1px solid",
              borderColor: "#2c333e",
            }}
          >
            <StatusItem label="Review" value={entry.reviewState} labelFn={formatReview as (s: string) => string} />
            <StatusItem label="Checks" value={entry.statuses.checks} labelFn={formatStatus as (s: string) => string} />
            <StatusItem label="Actions" value={entry.statuses.workflows} labelFn={formatStatus as (s: string) => string} />
            <StatusItem label="Statuses" value={entry.statuses.commits} labelFn={formatStatus as (s: string) => string} />
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
              gap: { xs: 2, sm: 2.5 },
              mt: 2.25,
            }}
          >
            <Box>
              <Typography variant="caption" sx={{ display: "block", mb: 1.125 }}>
                Requested reviewers
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {entry.requestedReviewers.length > 0 ? (
                  entry.requestedReviewers.map((reviewer) => (
                    <Chip
                      key={`${reviewer.type}-${reviewer.login}`}
                      label={
                        reviewer.type === "Team"
                          ? `@${reviewer.login} team`
                          : `@${reviewer.login}`
                      }
                      size="small"
                    />
                  ))
                ) : (
                  <Typography variant="body2" sx={{ color: "#737e8d", fontSize: 12 }}>
                    None assigned
                  </Typography>
                )}
              </Box>
            </Box>
            {entry.requiredReviewers.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ display: "block", mb: 1.125 }}>
                  Required by branch rules
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {entry.requiredReviewers.map((reviewer, index) => (
                    <Chip
                      key={`${reviewer.name}-${index}`}
                      label={`${reviewer.name} · ${reviewer.minimumApprovals} ${reviewer.minimumApprovals === 1 ? "approval" : "approvals"}`}
                      size="small"
                      sx={{
                        borderColor: "#645638",
                        color: "#e6cb8d",
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        </CardContent>
      </Box>
    </Card>
  );
}

function StatusItem({
  label,
  value,
  labelFn,
}: {
  label: string;
  value: string;
  labelFn: (s: string) => string;
}) {
  const colorMap: Record<string, string> = {
    passing: "#95d7bb",
    approved: "#95d7bb",
    failing: "#ff918b",
    changes_requested: "#ff918b",
    pending: "#f0c779",
    unknown: "#9da7b4",
    commented: "#9da7b4",
  };
  const color = colorMap[value] ?? "#9da7b4";

  return (
    <Box>
      <Typography variant="caption" sx={{ display: "block", mb: 1.125, fontSize: 9 }}>
        {label}
      </Typography>
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.875, color: "#b3bac4", fontSize: 12, whiteSpace: "nowrap" }}>
        <CircleIcon sx={{ fontSize: 7, color }} aria-hidden="true" />
        <span>{labelFn(value)}</span>
      </Box>
    </Box>
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
