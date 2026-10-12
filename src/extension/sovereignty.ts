// The report, produced and handed over.
//
// The decisions are in `core/audit/sovereignty.ts` and `core/audit/rfc3161.ts`. This is the part
// that needs the machine: the signing key, the authority's address, and writing a folder somebody
// can e-mail to an auditor.
//
// The signing key is generated here, once, and kept in the OS keychain — not in a setting, not in
// the workspace. The public key is written beside every report so an organisation can pin it the
// first time and notice if it ever changes, which is the only thing a self-signed report can offer:
// "this is the same machine that issued the last one, and neither report has been edited since".
// Everything stronger comes from the timestamp and from the SIEM stream, and the report says so.

import * as vscode from "vscode";
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readTimestampResponse, timestampRequest } from "../core/audit/rfc3161.js";
import { reportBytes, sovereignty, type ReportRow, type Sovereignty } from "../core/audit/sovereignty.js";
import { request } from "../core/util/http.js";
import { SECTION } from "./config.js";
import { t } from "../shared/i18n.js";

const KEY_ID = `${SECTION}.audit.signingKey`;

/**
 * The machine's own signing key, created on first use.
 *
 * Ed25519, in the keychain. Never in a setting: a signing key in `settings.json` is a signing key in
 * a screenshot, in a backup and in a support ticket.
 */
async function signingKey(secrets: vscode.SecretStorage): Promise<{ privatePem: string; publicPem: string }> {
  const existing = await secrets.get(KEY_ID);
  if (existing) {
    try {
      const key = createPrivateKey(existing);
      return {
        privatePem: existing,
        publicPem: createPublicKey(key).export({ type: "spki", format: "pem" }).toString(),
      };
    } catch {
      // A key we cannot read is replaced rather than thrown over: the alternative is a feature that
      // never works again on this machine. The new public key being different is itself the signal,
      // and the report says the key is the machine's own.
    }
  }
  const pair = generateKeyPairSync("ed25519");
  const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  await secrets.store(KEY_ID, privatePem);
  return { privatePem, publicPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString() };
}

export interface Produced {
  folder: string;
  report: Sovereignty;
  /** What the authority said, when one was configured. */
  timestamp?: { at?: string; refused?: string; error?: string };
}

/**
 * Build, sign, optionally timestamp, and write.
 *
 * The timestamp is taken over the CHAIN HEAD and not over the report: the head is the thing that
 * cannot be rewritten afterwards, and timestamping the report would only prove when the report was
 * written. Only that one hash leaves the machine.
 */
export async function produceReport(input: {
  rows: ReportRow[];
  window: { from: number; to: number };
  secrets: vscode.SecretStorage;
  folder: string;
  timestampUrl?: string;
}): Promise<Produced> {
  const report = sovereignty(input.rows, input.window);
  const bytes = reportBytes(report);
  const keys = await signingKey(input.secrets);
  const signature = sign(null, bytes, createPrivateKey(keys.privatePem));

  await mkdir(input.folder, { recursive: true });
  await writeFile(join(input.folder, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(input.folder, "report.sig"), signature.toString("base64"), "utf8");
  await writeFile(join(input.folder, "report.pub"), keys.publicPem, "utf8");
  await writeFile(
    join(input.folder, "HOW-TO-CHECK.txt"),
    [
      "What this folder is, and how to check it without trusting whoever handed it to you.",
      "",
      "  report.json   the report",
      "  report.sig    an Ed25519 signature over report.json, canonicalised with sorted keys",
      "  report.pub    the public key of the machine that issued it",
      "",
      "The signature is over the report with its keys sorted at every level, so re-serialising the",
      "JSON with a different key order does not change it. Verify it with the tool of your choice,",
      "or regenerate the canonical bytes with `reportBytes` from this extension's source.",
      "",
      "What the signature proves: report.json has not changed since it was issued, and it was issued",
      "by the machine holding the private key for report.pub. Pin that public key the first time and",
      "a different one next time means a different machine or a reinstalled one.",
      "",
      "What it does NOT prove: that the ledger the report was built from was true. Nothing produced",
      "on the audited machine can prove that. The two things that reach outside it are the timestamp",
      "below, if there is one, and the SIEM stream.",
      "",
      "head.tsq / head.tsr   the RFC 3161 timestamp over the chain head, when an authority was",
      "                      configured. This extension does NOT verify it — verification needs your",
      "                      own trust anchor, which is the point. Check it yourself:",
      "",
      "    openssl ts -verify -in head.tsr -queryfile head.tsq -CAfile your-tsa-ca.pem",
      "",
      "A timestamp over the chain head is what makes a rewritten ledger detectable: rewriting from",
      "the beginning produces a different head, and no authority ever saw it.",
      "",
    ].join("\n"),
    "utf8",
  );

  if (!input.timestampUrl?.trim() || !report.chain.head) return { folder: input.folder, report };

  // Only the hash. The authority is told one digest and nothing else about what it covers.
  const query = timestampRequest(report.chain.head);
  await writeFile(join(input.folder, "head.tsq"), query.der);
  try {
    const response = await request(input.timestampUrl.trim(), {
      method: "POST",
      headers: { "content-type": "application/timestamp-query" },
      // `fetch` wants a view rather than a Buffer; the bytes are the same.
      body: new Uint8Array(query.der),
      timeoutMs: 20_000,
      label: "timestamp",
    });
    if (!response.ok) {
      return { folder: input.folder, report, timestamp: { error: `the authority answered HTTP ${response.status}` } };
    }
    const der = Buffer.from(await response.arrayBuffer());
    const token = readTimestampResponse(der);
    if (token.refused) return { folder: input.folder, report, timestamp: { refused: token.refused } };
    await writeFile(join(input.folder, "head.tsr"), der);
    return { folder: input.folder, report, ...(token.genTime ? { timestamp: { at: token.genTime } } : { timestamp: {} }) };
  } catch (err) {
    // A timestamp that could not be obtained is reported, and the report is still handed over: the
    // signed document is worth having without it, and pretending otherwise would mean no report at
    // all whenever the authority is down.
    return { folder: input.folder, report, timestamp: { error: (err as Error).message.split("\n")[0] ?? "unknown" } };
  }
}

/** The command. Asks for the period, writes the folder, opens it. */
export async function sovereigntyReport(rows: ReportRow[], secrets: vscode.SecretStorage): Promise<void> {
  const choices = [
    { label: t("The last 7 days"), days: 7 },
    { label: t("The last 30 days"), days: 30 },
    { label: t("The last 90 days"), days: 90 },
    { label: t("Everything the ledger still holds"), days: 0 },
  ];
  const picked = await vscode.window.showQuickPick(choices, { title: t("Over what period?") });
  if (!picked) return;

  const to = Date.now();
  const from = picked.days ? to - picked.days * 86_400_000 : 0;
  const target = await vscode.window.showSaveDialog({
    title: t("Where should the report go?"),
    defaultUri: vscode.Uri.file(join(require("node:os").homedir() as string, `hivey-code-sovereignty-${new Date().toISOString().slice(0, 10)}`)),
  });
  if (!target) return;

  const url = vscode.workspace.getConfiguration(SECTION).get<string>("audit.timestampUrl", "").trim();
  const produced = await produceReport({ rows, window: { from, to }, secrets, folder: target.fsPath, ...(url ? { timestampUrl: url } : {}) });

  const lines = [
    t("{0} request(s) to {1} destination(s).", produced.report.requests, produced.report.destinations.length),
    produced.report.chain.intact
      ? t("The chain holds.")
      : t("⚠️ The chain does NOT hold — see the report."),
  ];
  if (produced.timestamp?.at) lines.push(t("Timestamped by the authority at {0}.", produced.timestamp.at));
  else if (produced.timestamp?.refused) lines.push(t("The timestamping authority refused: {0}", produced.timestamp.refused));
  else if (produced.timestamp?.error) lines.push(t("No timestamp: {0}", produced.timestamp.error));
  else if (!url) lines.push(t("No timestamping authority is configured, so nothing ties this to a clock outside this machine."));

  const open = await vscode.window.showInformationMessage(lines.join(" "), t("Open the folder"));
  if (open) void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(join(produced.folder, "report.json")));
}
