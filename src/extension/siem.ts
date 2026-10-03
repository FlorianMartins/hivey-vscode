// Shipping the egress ledger to the organisation's collector.
//
// Off by default, and that is not a formality: this sends a record of this machine's activity to a
// system with its own operators, its own retention and its own export. It is the right thing on a
// managed workstation inside a bank and the wrong thing on a developer's laptop, and nothing here
// can tell which one it is on. So an operator switches it on, names the collector, and chooses the
// identifier their people are known by.
//
// The decisions all live in `core/siem/`: what may leave (an allow-list of fields, never content),
// how it is framed, and what the queue does when the collector is down. This file is the wiring —
// the settings, the timer, and the one place that turns a ledger row into a queued one.

import * as vscode from "vscode";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { otlpLogs, syslogFrame, syslogMessage, type Identity } from "../core/siem/format.js";
import { SiemQueue, stuckFor, type QueueStore } from "../core/siem/queue.js";
import { sendOtlp, sendSyslogTls } from "../core/siem/transport.js";
import { request } from "../core/util/http.js";
import { SECTION } from "./config.js";
import { t } from "../shared/i18n.js";

export type SiemTransport = "off" | "syslog-tls" | "otlp";

export interface SiemSettings {
  transport: SiemTransport;
  host: string;
  port: number;
  url: string;
  /** Path to the collector's CA in PEM, when it is not one the machine already trusts. */
  caFile: string;
  rejectUnauthorized: boolean;
  /** Extra headers for OTLP: an API key, a tenant. */
  headers: Record<string, string>;
  /** ⚠️ Empty by default, and never defaulted to anything this extension could discover. */
  userId: string;
  /** How often the queue is flushed, in seconds. */
  flushSeconds: number;
}

export function readSiemSettings(): SiemSettings {
  const c = vscode.workspace.getConfiguration(SECTION);
  const headers = c.get<Record<string, string>>("siem.headers", {});
  return {
    transport: c.get<SiemTransport>("siem.transport", "off"),
    host: c.get<string>("siem.host", "").trim(),
    port: c.get<number>("siem.port", 6514),
    url: c.get<string>("siem.url", "").trim(),
    caFile: c.get<string>("siem.caFile", "").trim(),
    rejectUnauthorized: c.get<boolean>("siem.rejectUnauthorized", true),
    headers: headers && typeof headers === "object" ? headers : {},
    userId: c.get<string>("siem.userId", "").trim(),
    flushSeconds: Math.max(5, c.get<number>("siem.flushSeconds", 30)),
  };
}

/** The spool, in the extension's own storage rather than in the workspace. */
function spool(context: vscode.ExtensionContext): QueueStore {
  const path = join(context.globalStorageUri.fsPath, "siem-queue.json");
  return {
    read() {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    write(text) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, "utf8");
      } catch {
        // A spool we cannot write is a queue that lives only in memory for this session, which is
        // worse than durable and much better than throwing inside the egress path.
      }
    },
  };
}

export class SiemShipper {
  private readonly queue: SiemQueue;
  private timer: ReturnType<typeof setInterval> | undefined;
  private flushing = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
  ) {
    this.queue = new SiemQueue(spool(context));
  }

  /** Called for every ledger row. Queues it when a collector is configured, and nothing otherwise. */
  offer(row: Record<string, unknown>): void {
    const settings = readSiemSettings();
    if (settings.transport === "off") return;
    if (!this.queue.enqueue(row)) {
      this.log.appendLine(
        `[siem] the queue is full: ${this.queue.dropped()} row(s) have been dropped and will not reach the collector.`,
      );
    }
    this.start(settings.flushSeconds);
  }

  /** The timer starts only once there is something to ship. */
  private start(seconds: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), seconds * 1000);
    // Never keep the editor alive for a log shipper.
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** What the panel and the sovereignty report say about the stream. */
  status(): { depth: number; dropped: number; stuckMs?: number; lastSentAt?: number; transport: SiemTransport } {
    const stuck = stuckFor(this.queue);
    return {
      depth: this.queue.depth(),
      dropped: this.queue.dropped(),
      ...(stuck === undefined ? {} : { stuckMs: stuck }),
      ...(this.queue.lastSentAt() === undefined ? {} : { lastSentAt: this.queue.lastSentAt() }),
      transport: readSiemSettings().transport,
    };
  }

  /**
   * One attempt at the front of the queue.
   *
   * Never concurrent with itself: two flushes would send the same batch twice and, worse, one could
   * acknowledge rows the other was still sending.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    const settings = readSiemSettings();
    if (settings.transport === "off") return;
    const batch = this.queue.pending();
    if (!batch.length) {
      this.dispose();
      return;
    }
    this.flushing = true;
    try {
      const identity: Identity = {
        ...(settings.userId ? { user: settings.userId } : {}),
        host: vscode.env.machineId.slice(0, 12),
      };
      const result =
        settings.transport === "syslog-tls"
          ? await sendSyslogTls(
              batch.map((q) => syslogFrame(syslogMessage(q.row, identity))),
              {
                host: settings.host,
                port: settings.port,
                ...(settings.caFile ? { ca: readIfThere(settings.caFile) } : {}),
                rejectUnauthorized: settings.rejectUnauthorized,
              },
            )
          : await sendOtlp(
              otlpLogs(
                batch.map((q) => q.row),
                identity,
                this.context.extension.packageJSON.version as string,
              ),
              { url: settings.url, headers: settings.headers },
              // The project's own HTTP helper, which is the only path out of this process — so the
              // deadline, the abort handling and the error wording are the ones used everywhere else.
              async (input) => {
                const response = await request(input.url, {
                  method: input.method,
                  headers: input.headers,
                  body: input.body,
                  timeoutMs: input.timeoutMs,
                  label: "siem",
                });
                return { status: response.status, body: await response.text().catch(() => "") };
              },
            );

      if (result.ok) {
        this.queue.acknowledge(batch);
        return;
      }
      this.queue.failed(batch, result.why ?? "no reason given");
      this.log.appendLine(`[siem] ${batch.length} row(s) still waiting: ${result.why ?? "no reason given"}`);
    } finally {
      this.flushing = false;
    }
  }

  /** What the user sees when they ask. Never silent about a queue that is not moving. */
  async report(): Promise<void> {
    const status = this.status();
    if (status.transport === "off") {
      void vscode.window.showInformationMessage(t("No SIEM is configured, so nothing is being shipped."));
      return;
    }
    await this.flush();
    const after = this.status();
    const parts = [t("{0} row(s) waiting.", after.depth)];
    if (after.stuckMs !== undefined) parts.push(t("The oldest has been waiting {0} minute(s).", Math.round(after.stuckMs / 60000)));
    if (after.dropped) parts.push(t("{0} row(s) were dropped because the queue was full.", after.dropped));
    if (after.lastSentAt) parts.push(t("Last reached the collector at {0}.", new Date(after.lastSentAt).toLocaleString()));
    void vscode.window.showInformationMessage(parts.join(" "));
  }
}

function readIfThere(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
