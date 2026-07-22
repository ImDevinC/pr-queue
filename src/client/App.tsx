import { useEffect, useRef, useState } from "react";
import { useThemeMode } from "./ThemeContext.js";
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Chip,
  TextField,
  IconButton,
  Avatar,
  Divider,
  Alert,
  AppBar,
  Toolbar,
  Badge,
  Stack,
  Paper,
  Grid,
  Tooltip,
  Link,
} from "@mui/material";
import {
  VolumeUp,
  VolumeOff,
  OpenInNew,
  Circle,
  FilterList,
  Brightness4,
  Brightness7,
} from "@mui/icons-material";

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
  const { mode, toggleTheme } = useThemeMode();

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
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" elevation={0}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            PR Queue
          </Typography>
          <Badge
            badgeContent={visibleCount}
            color="secondary"
            sx={{ mr: 2 }}
          >
            <Typography variant="body2" color="inherit">
              {visibleCount === 1 ? "PR waiting" : "PRs waiting"}
            </Typography>
          </Badge>
          <Tooltip title={muted ? "Unmute notifications" : "Mute notifications"}>
            <IconButton color="inherit" onClick={toggleMute} size="small">
              {muted ? <VolumeOff /> : <VolumeUp />}
            </IconButton>
          </Tooltip>
          <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            <IconButton color="inherit" onClick={toggleTheme} size="small">
              {mode === "dark" ? <Brightness7 /> : <Brightness4 />}
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Stack spacing={2}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: "text.secondary",
              typography: "body2",
            }}
            aria-live="polite"
          >
            <Circle color="success" sx={{ fontSize: 12 }} />
            <span>Live queue</span>
            <Divider orientation="vertical" flexItem />
            <span>
              {queue ? `Updated ${formatTime(queue.updatedAt)}` : "Connecting…"}
            </span>
          </Box>

          {error && (
            <Alert severity="error">{error}. Retrying automatically.</Alert>
          )}

          {!queue && !error && (
            <Alert severity="info">Loading the review queue…</Alert>
          )}

          {queue && (
            <Paper elevation={1} sx={{ p: 2 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <FilterList color="action" />
                <TextField
                  id="repo-filter"
                  size="small"
                  label="Filter by repository"
                  value={filter}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilter(e.target.value)}
                  placeholder="e.g. terra or ImDevinC/*"
                  aria-describedby="repo-filter-hint"
                  fullWidth
                />
                <Typography
                  id="repo-filter-hint"
                  variant="caption"
                  color="text.secondary"
                  sx={{ whiteSpace: "nowrap" }}
                >
                  Use * as wildcard
                </Typography>
              </Stack>
            </Paper>
          )}

          {isFiltering && (
            <Typography variant="body2" color="text.secondary">
              Showing {visibleCount} of {totalCount} {totalCount === 1 ? "PR" : "PRs"}
            </Typography>
          )}

          {queue && filteredEntries.length === 0 && (
            <Paper elevation={1} sx={{ p: 4, textAlign: "center" }}>
              <Typography variant="h5" gutterBottom>
                {isFiltering ? "No matching pull requests" : "Nothing waiting"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {isFiltering
                  ? "Try adjusting your filter pattern."
                  : "The queue is clear."}
              </Typography>
            </Paper>
          )}

          {queue && filteredEntries.length > 0 && (
            <Stack spacing={2} component="section" aria-label="Pull requests waiting for review">
              {filteredEntries.map((entry) => (
                <PullRequestCard
                  entry={entry}
                  key={`${entry.repository}-${entry.number}`}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Container>
    </Box>
  );
}

function PullRequestCard({ entry }: { entry: QueueEntry }) {
  return (
    <Card elevation={2}>
      <CardContent>
        <Stack spacing={2}>
          <Box
            sx={{
              display: "flex",
              alignItems: { xs: "flex-start", sm: "center" },
              justifyContent: "space-between",
              gap: 2,
              flexDirection: { xs: "column", sm: "row" },
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
              <Chip
                label={entry.repository}
                color="primary"
                size="small"
                variant="outlined"
              />
              <Typography variant="body2" color="text.secondary">
                #{entry.number}
              </Typography>
            </Stack>
            <Link
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              underline="hover"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                typography: "body2",
                flexShrink: 0,
              }}
            >
              Open on GitHub <OpenInNew sx={{ fontSize: 16 }} />
            </Link>
          </Box>

          <Typography variant="h6" sx={{ wordBreak: "break-word" }}>
            {entry.title}
          </Typography>

          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              {entry.author.avatarUrl ? (
                <Avatar src={entry.author.avatarUrl} alt="" sx={{ width: 24, height: 24 }} />
              ) : (
                <Avatar sx={{ width: 24, height: 24 }}>
                  {entry.author.login.slice(0, 1).toUpperCase()}
                </Avatar>
              )}
              <Typography variant="body2">{entry.author.login}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Waiting {formatWaiting(entry.waitingSince)}
            </Typography>
          </Stack>

          <Divider />

          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatusItem label="Review" value={entry.reviewState} labelFn={formatReview} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatusItem label="Checks" value={entry.statuses.checks} labelFn={formatStatus} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatusItem label="Actions" value={entry.statuses.workflows} labelFn={formatStatus} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatusItem label="Statuses" value={entry.statuses.commits} labelFn={formatStatus} />
            </Grid>
          </Grid>

          <Divider />

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Requested reviewers
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
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
                      variant="outlined"
                    />
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    None assigned
                  </Typography>
                )}
              </Box>
            </Grid>
            {entry.requiredReviewers.length > 0 && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  Required by branch rules
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                  {entry.requiredReviewers.map((reviewer, index) => (
                    <Chip
                      key={`${reviewer.name}-${index}`}
                      label={`${reviewer.name} · ${reviewer.minimumApprovals} ${reviewer.minimumApprovals === 1 ? "approval" : "approvals"}`}
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  ))}
                </Box>
              </Grid>
            )}
          </Grid>
        </Stack>
      </CardContent>
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
  const colorMap: Record<string, "success" | "error" | "warning" | "default"> = {
    passing: "success",
    approved: "success",
    failing: "error",
    changes_requested: "error",
    pending: "warning",
    unknown: "default",
    commented: "default",
  };
  const color = colorMap[value] ?? "default";

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {label}
      </Typography>
      <Chip
        icon={<Circle sx={{ fontSize: 10 }} />}
        label={labelFn(value)}
        size="small"
        color={color}
        variant="outlined"
      />
    </Box>
  );
}

function formatStatus(status: string): string {
  return status === "unknown"
    ? "No signal"
    : status[0].toUpperCase() + status.slice(1);
}

function formatReview(status: string): string {
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
