import { describe, expect, it } from "vitest";
import {
  aggregateStatuses,
  applyQueueEvent,
  type QueueEntryState,
} from "./queue.js";

const activeState: QueueEntryState = {
  active: true,
  order: 4,
  headSha: "old-sha",
  lastReviewedSha: "old-sha",
  lastRequeuedSha: null,
  hasReviewRequest: true,
};

describe("queue state", () => {
  it("activates a ready pull request at the next order", () => {
    const result = applyQueueEvent(
      { ...activeState, active: false },
      { kind: "ready", headSha: "new-sha" },
      8,
    );
    expect(result).toMatchObject({
      active: true,
      order: 8,
      headSha: "new-sha",
    });
  });

  it("deactivates drafts and closed pull requests", () => {
    expect(applyQueueEvent(activeState, { kind: "draft" }, 9).active).toBe(
      false,
    );
    expect(applyQueueEvent(activeState, { kind: "close" }, 9).active).toBe(
      false,
    );
  });

  it("requeues once for a new reviewed head sha", () => {
    const result = applyQueueEvent(
      activeState,
      { kind: "synchronize", headSha: "new-sha", hasSubmittedReview: true },
      10,
    );
    expect(result).toMatchObject({
      order: 10,
      headSha: "new-sha",
      lastRequeuedSha: "new-sha",
    });
    expect(
      applyQueueEvent(
        result,
        { kind: "synchronize", headSha: "new-sha", hasSubmittedReview: true },
        11,
      ).order,
    ).toBe(10);
  });

  it("does not requeue an unreviewed pull request on synchronize", () => {
    const result = applyQueueEvent(
      { ...activeState, lastReviewedSha: null },
      { kind: "synchronize", headSha: "new-sha", hasSubmittedReview: false },
      10,
    );
    expect(result.order).toBe(4);
  });
});

describe("status aggregation", () => {
  it("prioritizes failures over pending and passing", () => {
    expect(
      aggregateStatuses([
        { state: "completed", conclusion: "success" },
        { state: "in_progress", conclusion: null },
        { state: "completed", conclusion: "failure" },
      ]),
    ).toBe("failing");
  });

  it("returns pending when work is incomplete and no failure exists", () => {
    expect(
      aggregateStatuses([{ state: "in_progress", conclusion: null }]),
    ).toBe("pending");
  });

  it("returns unknown without status signals", () => {
    expect(aggregateStatuses([])).toBe("unknown");
  });
});
