import type { MessageSummary } from "./types.js";

/** Plain-text rendering of messages, convenient for pasting into an LLM prompt. */
export function toTranscript(messages: MessageSummary[]): string {
  return messages
    .map((m) => {
      const time = m.createdAt.replace("T", " ").slice(0, 16);
      const reply = m.replyToMessageId ? ` (reply to ${m.replyToMessageId})` : "";
      const files = m.attachments.length > 0 ? ` [attachments: ${m.attachments.map((a) => a.url).join(", ")}]` : "";
      const embeds = m.embeds
        .map((e) => [e.title, e.url].filter(Boolean).join(" "))
        .filter((e) => e.length > 0)
        .map((e) => ` [embed: ${e}]`)
        .join("");
      return `[${time}] ${m.author.displayName} (${m.id})${reply}: ${m.content}${files}${embeds}`;
    })
    .join("\n");
}
