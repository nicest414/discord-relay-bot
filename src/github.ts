import { createHmac, timingSafeEqual } from "node:crypto";
import type { OutgoingEmbed } from "./types.js";

export function verifyGithubSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const actual = Buffer.from(signatureHeader);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type GithubUser = { login: string; avatar_url?: string; html_url?: string };
type GithubItem = { number: number; title: string; html_url: string; body?: string | null; merged?: boolean };

export type GithubPayload = {
  action?: string;
  repository?: { full_name: string };
  sender?: GithubUser;
  issue?: GithubItem & { pull_request?: unknown };
  pull_request?: GithubItem;
  comment?: { html_url: string; body?: string | null };
  review?: { html_url: string; state: string; body?: string | null };
};

const COLORS = {
  open: 0x2da44e,
  closed: 0xcf222e,
  merged: 0x8250df,
  comment: 0x0969da,
  neutral: 0x6e7781,
} as const;

const MAX_DESCRIPTION = 500;

function truncate(text: string | null | undefined, max = MAX_DESCRIPTION): string | undefined {
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function embed(
  payload: GithubPayload,
  title: string,
  url: string,
  color: number,
  description?: string | null,
): OutgoingEmbed {
  const repo = payload.repository?.full_name ?? "unknown repo";
  return {
    title: `[${repo}] ${title}`.slice(0, 256),
    url,
    color,
    description: truncate(description),
    author: payload.sender
      ? { name: payload.sender.login, icon_url: payload.sender.avatar_url, url: payload.sender.html_url }
      : undefined,
    timestamp: new Date().toISOString(),
  };
}

/** Returns null for events/actions that should not be relayed. */
export function formatGithubEvent(event: string, payload: GithubPayload): OutgoingEmbed | null {
  const action = payload.action;

  if (event === "issues" && payload.issue) {
    const issue = payload.issue;
    const label = `#${issue.number} ${issue.title}`;
    if (action === "opened") return embed(payload, `Issue opened: ${label}`, issue.html_url, COLORS.open, issue.body);
    if (action === "reopened") return embed(payload, `Issue reopened: ${label}`, issue.html_url, COLORS.open);
    if (action === "closed") return embed(payload, `Issue closed: ${label}`, issue.html_url, COLORS.closed);
    return null;
  }

  if (event === "pull_request" && payload.pull_request) {
    const pr = payload.pull_request;
    const label = `#${pr.number} ${pr.title}`;
    if (action === "opened") return embed(payload, `PR opened: ${label}`, pr.html_url, COLORS.open, pr.body);
    if (action === "reopened") return embed(payload, `PR reopened: ${label}`, pr.html_url, COLORS.open);
    if (action === "ready_for_review") return embed(payload, `PR ready for review: ${label}`, pr.html_url, COLORS.open);
    if (action === "closed") {
      return pr.merged
        ? embed(payload, `PR merged: ${label}`, pr.html_url, COLORS.merged)
        : embed(payload, `PR closed: ${label}`, pr.html_url, COLORS.closed);
    }
    return null;
  }

  if (event === "issue_comment" && action === "created" && payload.issue && payload.comment) {
    const kind = payload.issue.pull_request ? "PR" : "Issue";
    const label = `#${payload.issue.number} ${payload.issue.title}`;
    return embed(payload, `New comment on ${kind} ${label}`, payload.comment.html_url, COLORS.comment, payload.comment.body);
  }

  if (event === "pull_request_review" && action === "submitted" && payload.pull_request && payload.review) {
    const label = `#${payload.pull_request.number} ${payload.pull_request.title}`;
    const state = payload.review.state.toLowerCase();
    const verb = state === "approved" ? "approved" : state === "changes_requested" ? "requested changes on" : "reviewed";
    const color = state === "approved" ? COLORS.open : state === "changes_requested" ? COLORS.closed : COLORS.neutral;
    return embed(payload, `Review ${verb} PR ${label}`, payload.review.html_url, color, payload.review.body);
  }

  return null;
}
