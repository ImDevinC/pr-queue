import { describe, expect, it } from "vitest";
import { shouldActivatePullRequest } from "./processor.js";

describe("pull request queue activation", () => {
  it("activates non-draft pull requests when they open", () => {
    expect(shouldActivatePullRequest("opened", false)).toBe(true);
  });

  it("does not activate draft pull requests", () => {
    expect(shouldActivatePullRequest("opened", true)).toBe(false);
    expect(shouldActivatePullRequest("ready_for_review", true)).toBe(false);
  });

  it("activates ready and reopened non-draft pull requests", () => {
    expect(shouldActivatePullRequest("ready_for_review", false)).toBe(true);
    expect(shouldActivatePullRequest("reopened", false)).toBe(true);
  });

  it("does not activate unrelated pull request events", () => {
    expect(shouldActivatePullRequest("synchronize", false)).toBe(false);
    expect(shouldActivatePullRequest("review_requested", false)).toBe(false);
  });
});
