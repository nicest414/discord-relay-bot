import { describe, expect, it } from "vitest";
import { formatGithubEvent } from "../src/github.js";

const base = { repository: { full_name: "team/app" }, sender: { login: "bob" } };

describe("formatGithubEvent", () => {
  it("distinguishes merged and closed PRs", () => {
    const pr = { number: 1, title: "x", html_url: "https://github.com/team/app/pull/1" };
    expect(formatGithubEvent("pull_request", { ...base, action: "closed", pull_request: { ...pr, merged: true } })?.title).toBe(
      "[team/app] PR merged: #1 x",
    );
    expect(formatGithubEvent("pull_request", { ...base, action: "closed", pull_request: { ...pr, merged: false } })?.title).toBe(
      "[team/app] PR closed: #1 x",
    );
  });

  it("labels comments on PRs vs issues", () => {
    const comment = { html_url: "https://github.com/c", body: "lgtm" };
    const issue = { number: 2, title: "y", html_url: "https://github.com/i" };
    expect(formatGithubEvent("issue_comment", { ...base, action: "created", issue, comment })?.title).toContain("Issue #2");
    expect(
      formatGithubEvent("issue_comment", { ...base, action: "created", issue: { ...issue, pull_request: {} }, comment })?.title,
    ).toContain("PR #2");
  });

  it("formats review states", () => {
    const payload = {
      ...base,
      action: "submitted",
      pull_request: { number: 3, title: "z", html_url: "https://github.com/p" },
      review: { html_url: "https://github.com/r", state: "changes_requested" },
    };
    expect(formatGithubEvent("pull_request_review", payload)?.title).toBe("[team/app] Review requested changes on PR #3 z");
  });

  it("truncates long bodies", () => {
    const body = "a".repeat(1000);
    const result = formatGithubEvent("issues", {
      ...base,
      action: "opened",
      issue: { number: 4, title: "w", html_url: "https://github.com/i", body },
    });
    expect(result?.description).toHaveLength(500);
  });

  it("ignores unrelated actions", () => {
    expect(
      formatGithubEvent("issues", { ...base, action: "labeled", issue: { number: 5, title: "v", html_url: "u" } }),
    ).toBeNull();
  });
});
