// Why this query is slow, from what the database already knows.
//
// Db2 for i keeps something no other platform hands you so directly: a record of the indexes its
// own optimizer WISHED existed while real queries were running. `QSYS2.SYSIXADV` is that record.
// Together with the table statistics it is the difference between "add an index on CUSTNO, that
// usually helps" and "the optimizer asked for this exact key 4 812 times in the last month, over a
// table of 2.1 million rows".
//
// And it is the single easiest thing in this product to turn into bad advice, for a reason worth
// writing down: the Index Advisor is a WISH LIST, not a design. Every entry is the optimizer saying
// "for that one query, this key would have helped". Applied without judgement it produces a table
// with fourteen indexes, where every insert pays for all fourteen and the optimizer now has
// fourteen plans to cost. So nothing here recommends; it reports, with the numbers that let someone
// decide — and it says what the numbers do not mean.

export interface IndexAdvice {
  schema: string;
  table: string;
  /** The key the optimizer asked for, in order. Order is the whole content of an index. */
  keys: string;
  /** How many of the leading columns an equality predicate could use. */
  leading?: number;
  /** How many times the optimizer asked. Once is noise; thousands is a fact. */
  times: number;
  /** When it last asked. An entry from before the last release is about code that may be gone. */
  lastAdvised?: string;
  /** True when the system built a temporary index for it — the strongest signal there is. */
  temporaryUsed: boolean;
  reason?: string;
}

export interface TableStats {
  schema: string;
  table: string;
  rows?: number;
  /** Size on disk, in bytes, as the catalogue reports it. */
  size?: number;
  /** Permanent indexes already over this table. Each one is paid for on every insert. */
  indexes?: number;
}

/**
 * What the optimizer wished for, worst first.
 *
 * Ordered by how often it asked rather than by the estimated creation time: the question is "which
 * of these is real", and an index asked for four thousand times is real whatever it costs to build.
 */
export function indexAdviceSql(schema: string, table: string | undefined, limit = 25): string {
  const where = [`TABLE_SCHEMA = '${up(schema)}'`];
  if (table) where.push(`TABLE_NAME = '${up(table)}'`);
  return (
    `SELECT * FROM QSYS2.SYSIXADV WHERE ${where.join(" AND ")} ` +
    `ORDER BY TIMES_ADVISED DESC FETCH FIRST ${Math.trunc(limit)} ROWS ONLY`
  );
}

export function tableStatsSql(schema: string, table: string): string {
  return `SELECT * FROM QSYS2.SYSTABLESTAT WHERE TABLE_SCHEMA = '${up(schema)}' AND TABLE_NAME = '${up(table)}'`;
}

function up(value: string): string {
  return (value ?? "").trim().toUpperCase().replace(/'/g, "''");
}

type Read = (row: Record<string, unknown>, ...names: string[]) => string;

export function readAdvice(rows: Array<Record<string, unknown>>, read: Read): IndexAdvice[] {
  const out: IndexAdvice[] = [];
  for (const row of rows) {
    const keys = read(row, "KEY_COLUMNS_ADVISED", "KEYCOLUMNSADVISED", "KEYS_ADVISED");
    if (!keys) continue;
    const leading = Number(read(row, "LEADING_COLUMN_KEYS", "LEADINGCOLUMNKEYS"));
    const times = Number(read(row, "TIMES_ADVISED", "TIMESADVISED")) || 0;
    const last = read(row, "LAST_ADVISED", "LASTADVISED", "LAST_ADVISED_TIMESTAMP");
    const used = read(row, "MTI_USED", "MTIUSED", "MTI_CREATED");
    out.push({
      schema: read(row, "TABLE_SCHEMA", "SYSTEM_TABLE_SCHEMA").toUpperCase(),
      table: read(row, "TABLE_NAME", "SYSTEM_TABLE_NAME").toUpperCase(),
      keys,
      ...(Number.isFinite(leading) && leading > 0 ? { leading } : {}),
      times,
      ...(last ? { lastAdvised: last } : {}),
      // Any positive count, or a plain "YES": a temporary index the system actually built and used
      // is the strongest evidence in the whole file that the key is needed.
      temporaryUsed: /^(?:y|yes)$/i.test(used) || Number(used) > 0,
      ...(read(row, "REASON_ADVISED", "REASONADVISED") ? { reason: read(row, "REASON_ADVISED", "REASONADVISED") } : {}),
    });
  }
  return out;
}

/**
 * A figure, or nothing.
 *
 * `Number("")` is 0, and 0 is finite — so a column the catalogue did not return became "this table
 * has no rows", which is a measurement nobody made. The same rule as the evaluation report: an
 * absence is an absence, never a zero.
 */
function figure(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

export function readStats(rows: Array<Record<string, unknown>>, read: Read): TableStats | undefined {
  const row = rows[0];
  if (!row) return undefined;
  const rowCount = figure(read(row, "NUMBER_ROWS", "NUMBERROWS", "ROW_COUNT"));
  const size = figure(read(row, "DATA_SIZE", "TABLE_SIZE", "DATASIZE"));
  const indexes = figure(read(row, "NUMBER_INDEXES", "NUMBERINDEXES", "INDEX_COUNT"));
  return {
    schema: read(row, "TABLE_SCHEMA", "SYSTEM_TABLE_SCHEMA").toUpperCase(),
    table: read(row, "TABLE_NAME", "SYSTEM_TABLE_NAME").toUpperCase(),
    ...(rowCount === undefined ? {} : { rows: rowCount }),
    ...(size === undefined || size <= 0 ? {} : { size }),
    ...(indexes === undefined ? {} : { indexes }),
  };
}

/**
 * What the advice does NOT mean. Attached to every answer, not offered on request.
 *
 * Each of these is a mistake somebody makes with this view within a week of discovering it.
 */
export const ADVICE_LIMITS = [
  "the Index Advisor is a WISH LIST, not a design: each row is the optimizer saying “for that one query, this key would have helped”",
  "applying all of it gives a table a dozen indexes, and every insert, update and delete then pays for all of them",
  "an entry advised once or twice is noise — a query somebody ran by hand; thousands of times, over a recent date, is a fact",
  "the file is cleared by an IPL and can be cleared by hand, so an EMPTY advisor does not mean the indexes are right",
  "the key ORDER is the index: the same columns in another order is a different index and may help nothing",
];

/**
 * The report.
 *
 * The statistics first, because they are what makes the advice mean anything: the same advice over
 * a four-hundred-row table and over a four-million-row table are not the same proposal.
 */
export function formatAdvice(
  subject: { schema: string; table?: string },
  advice: IndexAdvice[],
  stats: TableStats | undefined,
  gaps: string[] = [],
): string {
  const where = subject.table ? `${subject.schema}.${subject.table}` : `schema ${subject.schema}`;
  const lines: string[] = [`What Db2 for i already knows about ${where}.`];

  if (stats) {
    const parts: string[] = [];
    if (stats.rows !== undefined) parts.push(`${stats.rows.toLocaleString("en")} row(s)`);
    if (stats.size !== undefined) parts.push(`${Math.round(stats.size / 1_048_576).toLocaleString("en")} MB of data`);
    if (stats.indexes !== undefined) parts.push(`${stats.indexes} index(es) already`);
    lines.push("", parts.length ? `The table: ${parts.join(", ")}.` : "The table: the catalogue returned no figures.");
  } else if (subject.table) {
    // Said, because the advice reads very differently without it.
    lines.push("", "No statistics came back for this table, so there is no size to judge the advice against.");
  }

  if (!advice.length) {
    lines.push(
      "",
      "The optimizer has not asked for any index on this. That is not the same as “the indexes are " +
        "right”: the advisor is cleared by an IPL, and a query nobody has run yet has asked for nothing.",
    );
  } else {
    lines.push("", `${advice.length} key(s) the optimizer asked for, most-asked first:`);
    for (const a of advice) {
      const bits = [`asked ${a.times.toLocaleString("en")}×`];
      if (a.lastAdvised) bits.push(`last ${a.lastAdvised}`);
      if (a.leading) bits.push(`${a.leading} leading column(s) usable for equality`);
      if (a.temporaryUsed) bits.push("the system BUILT a temporary index for it");
      lines.push(`  ${a.keys}`);
      lines.push(`    ${bits.join(" · ")}${a.reason ? ` · ${a.reason}` : ""}`);
    }
  }

  if (gaps.length) lines.push("", `What I could not read: ${gaps.join("; ")}.`);
  lines.push("", "Before proposing any of this:");
  for (const l of ADVICE_LIMITS) lines.push(`  - ${l}`);
  lines.push(
    "",
    "Creating an index is a CHANGE: it is bounded by hiveyCode.ibmi.writableLibraries like every " +
      "other change, it costs disk, and it slows every write to the table.",
  );
  return lines.join("\n");
}
