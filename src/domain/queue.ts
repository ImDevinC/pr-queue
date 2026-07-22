export type ReviewState =
  "pending" | "approved" | "changes_requested" | "commented";
export type AggregateStatus = "passing" | "failing" | "pending" | "unknown";

export interface QueueEntryState {
  active: boolean;
  order: number;
  headSha: string;
  lastReviewedSha: string | null;
  lastRequeuedSha: string | null;
  hasReviewRequest: boolean;
}

export interface QueueEventState {
  kind:
    "ready" | "close" | "draft" | "reopen" | "synchronize" | "review-requested";
  headSha?: string;
  draft?: boolean;
  closed?: boolean;
  hasSubmittedReview?: boolean;
}

export function applyQueueEvent(
  state: QueueEntryState,
  event: QueueEventState,
  nextOrder: number,
): QueueEntryState {
  if (event.kind === "close" || event.kind === "draft") {
    return { ...state, active: false };
  }

  if (
    event.kind === "ready" ||
    (event.kind === "reopen" && event.draft === false)
  ) {
    return {
      ...state,
      active: true,
      order: state.active ? state.order : nextOrder,
      headSha: event.headSha ?? state.headSha,
      lastRequeuedSha: null,
    };
  }

  if (event.kind === "synchronize") {
    const shouldRequeue =
      state.active &&
      Boolean(event.headSha) &&
      event.headSha !== state.headSha &&
      event.headSha !== state.lastRequeuedSha;

    return {
      ...state,
      headSha: event.headSha ?? state.headSha,
      order: shouldRequeue ? nextOrder : state.order,
      lastRequeuedSha: shouldRequeue
        ? (event.headSha ?? null)
        : state.lastRequeuedSha,
    };
  }

  if (event.kind === "review-requested") {
    return {
      ...state,
      order: state.active ? nextOrder : state.order,
      hasReviewRequest: true,
    };
  }

  return state;
}

export function aggregateStatuses(
  statuses: Array<{ state: string; conclusion?: string | null }>,
): AggregateStatus {
  if (statuses.length === 0) return "unknown";
  if (
    statuses.some((status) =>
      ["failure", "timed_out", "action_required", "error"].includes(
        status.conclusion ?? status.state,
      ),
    )
  ) {
    return "failing";
  }
  if (
    statuses.some(
      (status) =>
        !["success", "neutral", "skipped"].includes(
          status.conclusion ?? status.state,
        ),
    )
  ) {
    return "pending";
  }
  return "passing";
}
