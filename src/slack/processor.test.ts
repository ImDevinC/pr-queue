import { describe, expect, it } from "vitest";
import { extractPullRequestLinks } from "./processor.js";

describe("extractPullRequestLinks", () => {
  it("extracts a single PR link", () => {
    const text = "Check out https://github.com/acme/frontend/pull/42";
    const links = extractPullRequestLinks(text);
    expect(links).toEqual([{ org: "acme", repo: "frontend", number: 42 }]);
  });

  it("extracts multiple PR links", () => {
    const text =
      "PRs: https://github.com/acme/frontend/pull/1 and https://github.com/acme/backend/pull/2";
    const links = extractPullRequestLinks(text);
    expect(links).toEqual([
      { org: "acme", repo: "frontend", number: 1 },
      { org: "acme", repo: "backend", number: 2 },
    ]);
  });

  it("deduplicates repeated links", () => {
    const text =
      "https://github.com/acme/repo/pull/3 https://github.com/acme/repo/pull/3";
    const links = extractPullRequestLinks(text);
    expect(links).toEqual([{ org: "acme", repo: "repo", number: 3 }]);
  });

  it("returns empty array when no links present", () => {
    const text = "Just a regular message with no links";
    const links = extractPullRequestLinks(text);
    expect(links).toEqual([]);
  });

  it("ignores non-PR github links", () => {
    const text =
      "https://github.com/acme/frontend/issues/42 https://github.com/acme/frontend/pull/42";
    const links = extractPullRequestLinks(text);
    expect(links).toEqual([{ org: "acme", repo: "frontend", number: 42 }]);
  });

  it("matches http and https", () => {
    const text =
      "http://github.com/acme/frontend/pull/1 https://github.com/acme/frontend/pull/2";
    const links = extractPullRequestLinks(text);
    expect(links).toEqual([
      { org: "acme", repo: "frontend", number: 1 },
      { org: "acme", repo: "frontend", number: 2 },
    ]);
  });

  it("matches links without protocol", () => {
    const text = "github.com/acme/frontend/pull/99";
    const links = extractPullRequestLinks(text);
    expect(links).toEqual([{ org: "acme", repo: "frontend", number: 99 }]);
  });
});
