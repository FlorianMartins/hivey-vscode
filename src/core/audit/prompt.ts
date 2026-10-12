// Exactly what left the machine, for the one person entitled to see it.
//
// This product's whole argument is "your code does not leave, and when it does you can see what
// did". The second half was answered by a ledger: when, where to, which model, how many tokens, how
// many placeholders. Deliberately **never the content** — a log of what you were trying to keep
// private is not a privacy feature, and that rule is not being loosened here.
//
// What was missing is a different question, asked at a different moment. The ledger answers "what
// has left over time". Nobody could answer "what, literally, did you just send?" — and that is the
// question somebody asks once, before trusting the thing, and again the first time an answer is
// strange. An argument that cannot be checked is a claim.
//
// So this renders the LAST request, from memory:
//
//   • THE REDACTED FORM, which is the form that left. Showing the original would show something
//     that did not leave, which would be a worse lie than showing nothing — the audit would say the
//     client name went out when a marker went out.
//   • NOTHING IS PERSISTED. It lives as long as the session and is rendered on demand. It is not in
//     the ledger, not on disk, and not in a log. The ledger's rule stands.
//   • SIZES PER MESSAGE, because "why is this request 40 000 tokens" is answered by the list and not
//     by the total.

export interface AuditMessage {
  role: string;
  content: string;
  /** Names only. The schemas are long and nobody audits a JSON schema for privacy. */
  images?: number;
}

export interface PromptAudit {
  at: number;
  model: string;
  host: string;
  /** True when the endpoint was on this machine or this network, so nothing was redacted. */
  isLocal: boolean;
  messages: AuditMessage[];
  /** The tools offered with the request, by name. */
  tools: string[];
  /** How many placeholders were substituted, by kind — `EMAIL×3`. Empty on a local endpoint. */
  redactions: string;
}

/** Roughly, and only to attribute: four characters a token is close enough to rank a list. */
const tokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * The audit, as the read-only document a person reads.
 *
 * Markdown, because it is read in the editor the user already has open, and because a message
 * containing code has to stay legible — fenced, so a prompt full of backticks does not break the
 * page it is being shown on.
 */
export function renderPromptAudit(audit: PromptAudit): string {
  const total = audit.messages.reduce((sum, m) => sum + tokens(m.content), 0);
  const out: string[] = [
    "# The last request, as it was sent",
    "",
    `- **When**: ${new Date(audit.at).toISOString()}`,
    `- **Model**: \`${audit.model}\``,
    `- **To**: \`${audit.host}\`${audit.isLocal ? " — on this machine or this network" : ""}`,
    `- **Messages**: ${audit.messages.length}, about ${total.toLocaleString("en-US")} tokens`,
    `- **Tools offered**: ${audit.tools.length ? audit.tools.map((n) => `\`${n}\``).join(", ") : "none"}`,
    "",
  ];

  if (audit.isLocal) {
    out.push(
      "This went to a local endpoint, so **nothing was pseudonymized**: redacting text that never",
      "leaves the machine costs answer quality and buys nothing. What is below is the text verbatim.",
      "",
    );
  } else {
    out.push(
      "**This is the pseudonymized form — the form that actually left.** Markers like `⟨EMAIL_1⟩`",
      "are what the provider received; the table mapping them back never leaves this machine.",
      audit.redactions
        ? `Substituted: ${audit.redactions}.`
        : "Nothing matched a pattern, so nothing was substituted.",
      "",
    );
  }

  out.push(
    "Nothing here is stored. It is held for this session and rendered when you ask; the egress log",
    "keeps the metadata and never the content, and that has not changed.",
    "",
    "---",
    "",
  );

  for (const [index, message] of audit.messages.entries()) {
    const size = tokens(message.content).toLocaleString("en-US");
    const images = message.images ? `, ${message.images} image(s) — not shown, and not redactable` : "";
    out.push(`## ${index + 1}. ${message.role} — ~${size} tokens${images}`, "", fence(message.content), "");
  }
  return out.join("\n");
}

/**
 * A fence long enough to survive its contents.
 *
 * A prompt carries code, and code carries backticks. Three of them would end the block in the middle
 * of the thing being audited, and the rest of the document would render as prose — which is how an
 * audit comes to hide what it was opened to show.
 */
function fence(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}\n${text}\n${ticks}`;
}
