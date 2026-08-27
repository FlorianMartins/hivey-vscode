// What an assistant has to know before it writes a line of IBM i code.
//
// Every other language in this extension shares one assumption: a line of source is free text, and
// whitespace is decoration. On IBM i that assumption is false often enough to be dangerous. An RPG
// III calculation specification means something different in column 26 than in column 36; a DDS
// record name lives in columns 19-28 and nowhere else; a COBOL paragraph in Area A is a paragraph
// and in Area B is a syntax error. A model that was trained mostly on free-form code will happily
// emit `if x = 1;` into a fixed-format member, and the result does not fail visibly — it fails at
// compile time, in a spool file, in a language whose error messages are message ids.
//
// So this module does one thing: for a given source member, say exactly which dialect it is and
// what the immovable rules of that dialect are. The result is injected into the prompt. It is
// deliberately written as instructions to a model rather than as documentation for a human,
// because that is where it is read.
//
// Nothing here talks to a machine. The connection lives in the extension layer; this stays in core
// so it can be tested without an IBM i, which matters — almost nobody developing this extension
// will have a partition to hand.

export type IbmiLanguageId =
  | "rpg3"
  | "rpgle-fixed"
  | "rpgle-free"
  | "sqlrpgle"
  | "cl"
  | "dds-pf"
  | "dds-lf"
  | "dds-dspf"
  | "dds-prtf"
  | "db2"
  | "cobol"
  | "cmd";

export interface IbmiLanguage {
  id: IbmiLanguageId;
  /** How a developer on the platform names it. */
  label: string;
  /** The source member type the compiler expects — RPGLE, SQLRPGLE, CLLE, PF, DSPF… */
  memberType: string;
  /** True when the position of a character on the line changes its meaning. */
  fixedForm: boolean;
  /** How a comment is written. Getting this wrong ruins a whole member. */
  comment: string;
  /** The rules a model must respect, in the imperative. Injected verbatim into the prompt. */
  rules: string[];
}

/**
 * The column ruler for a fixed-format dialect.
 *
 * This is not documentation, it is a measuring tape: the model is shown the ruler alongside the
 * source so it can count. Without it a model reproduces the *shape* of RPG — the right keywords in
 * roughly the right places — which compiles about as often as a guess.
 */
const RULERS: Partial<Record<IbmiLanguageId, string>> = {
  rpg3: [
    "     ....5....10...15...20...25...30...35...40...45...50...55...60...65...70...75...80",
    "     |    |     |                        |         |         |    |    |    |",
    "    6=spec letter (H F E L I C O)   7=* marks a comment line",
    "    C spec: 7-8 control level · 9-17 indicators · 18-27 factor 1 · 28-32 operation",
    "            33-42 factor 2 · 43-48 result field · 49-51 length · 52 decimals",
    "            54-59 resulting indicators · 60-80 comment",
  ].join("\n"),
  "rpgle-fixed": [
    "     ....5....10...15...20...25...30...35...40...45...50...55...60...65...70...75...80",
    "    6=spec letter (H F D I C O P)   7=* or // marks a comment",
    "    D spec: 7-21 name · 24 DS/S/C/PR/PI · 33-39 length · 40 type · 41-42 decimals · 44-80 keywords",
    "    C spec: 8-9 level · 10-11 n01 · 12-25 factor 1 · 26-35 operation+extender",
    "            36-49 factor 2 · 50-63 result · 64-68 length · 69-70 decimals · 71-76 indicators",
    "    Code stops at column 80. Nothing after column 80 is compiled.",
  ].join("\n"),
  "dds-pf": DDS_RULER(),
  "dds-lf": DDS_RULER(),
  "dds-dspf": DDS_RULER(),
  "dds-prtf": DDS_RULER(),
  cobol: [
    "    ....5..7.9...12..............................................................72",
    "    1-6 sequence (leave blank) · 7 indicator (* comment, - continuation, / page eject)",
    "    8-11 Area A: division, section, paragraph and 01/77 level names START HERE",
    "    12-72 Area B: everything else · 73-80 ignored by the compiler",
  ].join("\n"),
};

function DDS_RULER(): string {
  return [
    "     ....5....10...15...20...25...30...35...40...45...50...55...60...65...70...75...80",
    "    6=A (always) · 7=* marks a comment · 17=R for a record format, blank for a field",
    "    19-28 name · 30-34 length · 35 data type (A P S B O F) · 36-37 decimal positions",
    "    38 usage (blank/I/O/B/H/M) · 39-41 line · 42-44 position · 45-80 keywords",
    "    A keyword that does not fit continues on the next line with a + or - at column 80.",
  ].join("\n");
}

const LANGUAGES: Record<IbmiLanguageId, IbmiLanguage> = {
  rpg3: {
    id: "rpg3",
    label: "RPG III (RPG/400)",
    memberType: "RPG",
    fixedForm: true,
    comment: "* in column 7",
    rules: [
      "This is RPG III, not ILE RPG. There are no procedures, no /free, no built-in functions and no long names.",
      "Every specification is fixed-format and identified by its letter in column 6, in this order: H, F, E, L, I, C, O.",
      "Names are at most 6 characters and uppercase. Field names longer than 6 characters do not compile.",
      "Control flow is IF/ELSE/END, DO/END, GOTO with TAG, and indicators *IN01 to *IN99. There is no ENDIF and no ENDDO.",
      "Arithmetic uses ADD, SUB, MULT, DIV, Z-ADD and Z-SUB with factor 1, factor 2 and a result field — never an expression.",
      "Do not suggest free-form, %BIFs, or EVAL: none of them exist in this compiler.",
    ],
  },
  "rpgle-fixed": {
    id: "rpgle-fixed",
    label: "ILE RPG, fixed format",
    memberType: "RPGLE",
    fixedForm: true,
    comment: "* in column 7, or // anywhere",
    rules: [
      "This member is fixed-format ILE RPG. Keep every specification in its columns; column 6 carries the spec letter.",
      "Code stops at column 80. A line that runs past column 80 is silently truncated by the compiler, which is worse than an error.",
      "You may use /free … /end-free blocks if the member already contains them; otherwise stay in fixed format.",
      "Built-in functions (%trim, %scan, %found, %eof, %parms…) are available — this is ILE, not RPG III.",
      "Use ENDIF, ENDDO, ENDSL and ENDSR to close blocks; RPG III's bare END is accepted but nobody writes it any more.",
    ],
  },
  "rpgle-free": {
    id: "rpgle-free",
    label: "ILE RPG, fully free",
    memberType: "RPGLE",
    fixedForm: false,
    comment: "//",
    rules: [
      "This member is fully free-form: it starts with **FREE in column 1 of line 1, and no column rules apply.",
      "Declare with the free-form specs: ctl-opt, dcl-f, dcl-s, dcl-ds, dcl-c, dcl-pr, dcl-pi, dcl-proc, dcl-subf.",
      "Every statement ends with a semicolon. Blocks close with endif, enddo, endfor, endsl, endmon, endsr, end-proc.",
      "Prefer built-in functions over opcodes: %trim, %subst, %scan, %len, %found, %eof, %error, %date, %timestamp, %char, %int, %dec.",
      "Guard I/O with the (e) extender and %error, or with monitor / on-error, rather than with resulting indicators.",
      "Free-form still has a 80-column *source* limit only if the member was created with RCDLEN 92 — keep lines reasonable and wrap with a trailing + inside literals.",
    ],
  },
  sqlrpgle: {
    id: "sqlrpgle",
    label: "ILE RPG with embedded SQL",
    memberType: "SQLRPGLE",
    fixedForm: false,
    comment: "//",
    rules: [
      "This member is compiled by CRTSQLRPGI: it is RPG with embedded SQL, and the SQL is precompiled before the RPG compiler ever sees it.",
      "Every embedded statement is written exec sql <statement>; — including the terminating semicolon, on one logical statement.",
      "Host variables are RPG fields prefixed with a colon (:custNo). They must be declared in RPG before the SQL that uses them.",
      "Check SQLCODE or SQLSTATE after every statement. SQLCODE = 0 is success, 100 is 'not found', negative is an error.",
      "Use a cursor (declare / open / fetch / close) for multi-row results; a bare SELECT INTO fails with SQLCODE -811 when it returns more than one row.",
      "Never build SQL by concatenating a host variable into the statement text: use parameter markers and PREPARE, or pass the value as a host variable.",
      "SET OPTION lines (COMMIT, CLOSQLCSR, DATFMT, NAMING) must appear before the first executable statement.",
    ],
  },
  cl: {
    id: "cl",
    label: "Control Language (CL/CLLE)",
    memberType: "CLLE",
    fixedForm: false,
    comment: "/* … */",
    rules: [
      "This is CL. A program starts with PGM (optionally PARM(&A &B)) and ends with ENDPGM.",
      "Every variable is declared with DCL VAR(&NAME) TYPE(*CHAR|*DEC|*LGL) LEN(...) and its name always starts with &.",
      "Assign with CHGVAR VAR(&X) VALUE(...). There is no expression statement: everything is a command with parameters.",
      "Handle errors with MONMSG MSGID(CPF0000) EXEC(...) — a MONMSG immediately after a command applies to that command; one after the DCLs applies to the whole program.",
      "Conditionals are IF COND(&X *EQ 'Y') THEN(DO) … ENDDO. Comparison operators are *EQ *NE *GT *LT *GE *LE *AND *OR *NOT.",
      "Continue a long command onto the next line with a trailing + or -.",
      "Prefer CLLE (ILE) over CLP (OPM) for anything new: it can call ILE procedures and handles errors properly.",
    ],
  },
  "dds-pf": {
    id: "dds-pf",
    label: "DDS physical file",
    memberType: "PF",
    fixedForm: true,
    comment: "* in column 7",
    rules: [
      "This is DDS for a physical file. Column 6 is always A. A record format is R in column 17 with its name in 19-28.",
      "Field names are at most 10 characters, uppercase, and start in column 19.",
      "Data types in column 35: A character, P packed, S zoned, B binary, F float, L date, T time, Z timestamp.",
      "UNIQUE goes on its own line before the record format. Key fields are listed after the fields with K in column 17.",
      "Prefer REFFLD or a field reference file (REF) over repeating lengths, and always give a COLHDG and TEXT.",
      "New tables are usually better created in SQL DDL than in DDS; say so if the user has the choice, but do not rewrite an existing DDS member into SQL unless asked.",
    ],
  },
  "dds-lf": {
    id: "dds-lf",
    label: "DDS logical file",
    memberType: "LF",
    fixedForm: true,
    comment: "* in column 7",
    rules: [
      "This is DDS for a logical file: it has no data of its own, only a view over one or more physical files.",
      "PFILE names the based-on physical file for a simple logical; JFILE plus JOIN/JFLD builds a join logical, which is read-only.",
      "List only the fields you want to expose; an empty field list inherits every field of the PFILE.",
      "Key fields carry K in column 17. Select and omit rules use S and O in column 17 with COMP, VALUES or RANGE.",
      "A join logical cannot be updated and cannot have select/omit on a secondary file field unless that field is in the format.",
    ],
  },
  "dds-dspf": {
    id: "dds-dspf",
    label: "DDS display file",
    memberType: "DSPF",
    fixedForm: true,
    comment: "* in column 7",
    rules: [
      "This is DDS for a 5250 display file. The screen is 24×80 (or 27×132 with DSPSIZ) and positions are absolute: line in 39-41, column in 42-44.",
      "Function keys are CFxx (returns the data) or CAxx (does not). Put INDARA on the file level so indicators live in a separate area.",
      "A subfile needs two record formats: the SFL itself and its SFLCTL, with SFLSIZ, SFLPAG, SFLDSP, SFLDSPCTL, SFLCLR and SFLEND.",
      "Field usage in column 38: blank or O output, I input, B both, H hidden, M message.",
      "Use DSPATR(HI RI UL ND PC) for attributes and EDTCDE/EDTWRD for numeric formatting. Every attribute costs a screen position.",
      "Never place two fields so their positions overlap — the compiler reports it as a position error, not as an overlap.",
    ],
  },
  "dds-prtf": {
    id: "dds-prtf",
    label: "DDS printer file",
    memberType: "PRTF",
    fixedForm: true,
    comment: "* in column 7",
    rules: [
      "This is DDS for a printer file. Lines are relative (SPACEB/SPACEA/SKIPB/SKIPA) or absolute by line number in 39-41.",
      "Page geometry comes from PAGESIZE, LPI and CPI at file level; overflow is OVRFLW on one record format.",
      "Use EDTCDE or EDTWRD for every numeric field: an unedited packed field prints as unreadable characters.",
      "Text constants are written in columns 45-80 in quotes; continue with a trailing + and resume in the next line's 45-80.",
    ],
  },
  db2: {
    id: "db2",
    label: "Db2 for i SQL",
    memberType: "SQL",
    fixedForm: false,
    comment: "-- or /* … */",
    rules: [
      "This is Db2 for i, not Db2 LUW, not Oracle and not SQL Server. Its dialect differs in ways that matter.",
      "Qualify with LIBRARY.OBJECT in SQL naming, or LIBRARY/OBJECT in system naming — the naming option is set per program and changes which one is legal.",
      "Limit rows with FETCH FIRST n ROWS ONLY. LIMIT works on current releases but FETCH FIRST is what the platform's own tooling writes.",
      "A SELECT with no FROM needs FROM SYSIBM.SYSDUMMY1.",
      "The catalogue lives in QSYS2 and SYSIBM: QSYS2.SYSTABLES, QSYS2.SYSCOLUMNS, QSYS2.SYSINDEXES, QSYS2.OBJECT_STATISTICS, QSYS2.SYSPARTITIONSTAT.",
      "IBM i services are table functions, not commands: QSYS2.ACTIVE_JOB_INFO(), QSYS2.OBJECT_STATISTICS(), QSYS2.IFS_OBJECT_STATISTICS().",
      "Run a CL command from SQL with CALL QSYS2.QCMDEXC('...'). Do not suggest xp_cmdshell or system().",
      "A table created by DDS has a system name of at most 10 characters; a long SQL name has both, and the two can differ. Mention the system name when it matters.",
    ],
  },
  cobol: {
    id: "cobol",
    label: "ILE COBOL",
    memberType: "CBLLE",
    fixedForm: true,
    comment: "* in column 7",
    rules: [
      "This is ILE COBOL for IBM i, in fixed format. Area A is columns 8-11, Area B is 12-72, and 73-80 are ignored.",
      "Division headers, section headers, paragraph names and 01/77 level numbers start in Area A. Everything else starts in Area B.",
      "A period ends a sentence and its absence is the most common bug in the language — scope terminators (END-IF, END-PERFORM, END-READ) are safer.",
      "File I/O is declared in the ENVIRONMENT DIVISION's FILE-CONTROL and described in the DATA DIVISION's FILE SECTION.",
      "Embedded SQL, when present, is written EXEC SQL … END-EXEC and the member type is SQLCBLLE.",
    ],
  },
  cmd: {
    id: "cmd",
    label: "Command definition",
    memberType: "CMD",
    fixedForm: false,
    comment: "/* … */",
    rules: [
      "This is a command definition source, compiled by CRTCMD. It describes an interface, not a program.",
      "CMD PROMPT('...') comes first, then one PARM per parameter with KWD, TYPE, LEN, MIN, PROMPT and any CHOICE or VALUES.",
      "Parameters are passed positionally to the CPP in the order the PARM statements appear.",
      "Validity checking beyond types belongs in a VCP or in the CPP, not in the command definition.",
    ],
  },
};

/** Extension → dialect, for the cases where the file name settles it. */
const BY_EXTENSION: Array<[RegExp, IbmiLanguageId]> = [
  [/\.sqlrpgle$/i, "sqlrpgle"],
  [/\.sqlclle$/i, "cl"],
  [/\.rpgle$/i, "rpgle-free"],
  [/\.(?:rpg36|rpt36|rpg38|rpt38|rpt)$/i, "rpg3"],
  [/\.rpg$/i, "rpg3"],
  [/\.(?:clle|clp|cl)$/i, "cl"],
  [/\.(?:sqlcblle|cblle|cbl|cobol)$/i, "cobol"],
  [/\.dspf$/i, "dds-dspf"],
  [/\.prtf$/i, "dds-prtf"],
  [/\.lf$/i, "dds-lf"],
  [/\.(?:pf|dds|table)$/i, "dds-pf"],
  [/\.cmd$/i, "cmd"],
  [/\.(?:sql|view|sqlprc|sqludf|sqltrg)$/i, "db2"],
];

/** Member type → dialect, which is what a QSYS member actually carries. */
const BY_MEMBER_TYPE: Record<string, IbmiLanguageId> = {
  RPG: "rpg3",
  RPG36: "rpg3",
  RPG38: "rpg3",
  RPT: "rpg3",
  RPT36: "rpg3",
  RPT38: "rpg3",
  RPGLE: "rpgle-free",
  SQLRPGLE: "sqlrpgle",
  CLP: "cl",
  CLLE: "cl",
  CLP38: "cl",
  SQLCLLE: "cl",
  CBL: "cobol",
  CBLLE: "cobol",
  SQLCBL: "cobol",
  SQLCBLLE: "cobol",
  PF: "dds-pf",
  LF: "dds-lf",
  DSPF: "dds-dspf",
  PRTF: "dds-prtf",
  CMD: "cmd",
  SQL: "db2",
  TABLE: "db2",
  VIEW: "db2",
};

/**
 * Which IBM i dialect this source is, or undefined when it is not IBM i source at all.
 *
 * The file name is a hint and the CONTENT is the arbiter, because the platform's own conventions
 * collide: `.rpgle` covers both a fully free member and a fixed-format one that has not been
 * converted yet, and telling a model the wrong one produces code that cannot compile. Two lines of
 * the member settle it — `**FREE` in column 1, or a specification letter in column 6 — so we read
 * them rather than trusting the extension.
 */
export function detectIbmiLanguage(path: string, text?: string): IbmiLanguage | undefined {
  const member = memberTypeOf(path);
  let id: IbmiLanguageId | undefined = member ? BY_MEMBER_TYPE[member.toUpperCase()] : undefined;
  if (!id) {
    for (const [re, candidate] of BY_EXTENSION) {
      if (re.test(path)) {
        id = candidate;
        break;
      }
    }
  }
  if (!id) return undefined;

  if (text !== undefined && (id === "rpgle-free" || id === "rpgle-fixed" || id === "sqlrpgle")) {
    id = refineRpg(id, text);
  }
  return LANGUAGES[id];
}

/** Every dialect, for the settings UI and the tests. */
export function ibmiLanguages(): IbmiLanguage[] {
  return Object.values(LANGUAGES);
}

export function ibmiLanguageById(id: string): IbmiLanguage | undefined {
  return LANGUAGES[id as IbmiLanguageId];
}

/**
 * Fixed format or free format — decided by the member, not by its name.
 *
 * `**FREE` in the first five characters of the source is the compiler's own switch, so it settles
 * the question outright. Failing that, a specification letter in column 6 on a line that is not a
 * comment means the member is fixed-format, whatever the file is called. Embedded SQL is orthogonal
 * to both: an SQLRPGLE member is free or fixed exactly like an RPGLE one.
 */
function refineRpg(id: IbmiLanguageId, text: string): IbmiLanguageId {
  const sql = id === "sqlrpgle" || /^\s*(?:\/)?exec\s+sql\b/im.test(text);
  if (/^\s{0,4}\*\*free\b/i.test(text)) return sql ? "sqlrpgle" : "rpgle-free";

  const lines = text.split(/\r?\n/, 400);
  let fixed = 0;
  let free = 0;
  for (const line of lines) {
    if (!line.trim() || line.length < 6) continue;
    const spec = line[5];
    const seventh = line[6];
    if (spec && /[HFDILCOPUE]/i.test(spec) && seventh !== "*" && /^\s{5}$/.test(line.slice(0, 5))) fixed++;
    if (/^\s*(?:ctl-opt|dcl-[fsdcpi]|dcl-proc|dcl-pr|dcl-pi|end-proc|\/free)\b/i.test(line)) free++;
  }
  if (fixed > free) return sql ? "sqlrpgle" : "rpgle-fixed";
  return sql ? "sqlrpgle" : "rpgle-free";
}

/**
 * The member type encoded in a QSYS path, if this is one.
 *
 * Code for IBM i addresses a source member as `/LIB/SRCFILE/MBR.TYPE`, so the type is the
 * extension of the last segment — but only when the path has the shape of a member. Applying that
 * rule to an IFS path would call `README.md` a member of type MD.
 */
export function memberTypeOf(path: string): string | undefined {
  const m = /^\/?(?:[^/]+)\/([^/]+)\/([^/.]+)\.([A-Za-z0-9]+)$/.exec(path.replace(/^member:/, ""));
  if (!m) return undefined;
  const type = m[3]!.toUpperCase();
  return type in BY_MEMBER_TYPE ? type : undefined;
}

/**
 * The instructions for a dialect, ready to append to a system prompt.
 *
 * The ruler is included only for fixed-format dialects, and only once: it is the single most
 * expensive part of this text and worth nothing to a free-form member.
 */
export function ibmiPrompt(lang: IbmiLanguage): string {
  const out = [`The file being discussed is ${lang.label} (source member type ${lang.memberType}).`];
  out.push(`Comments are written ${lang.comment}.`);
  out.push(...lang.rules.map((r) => `- ${r}`));
  const ruler = RULERS[lang.id];
  if (lang.fixedForm && ruler) {
    out.push("");
    out.push("Column layout — count characters against this ruler before you write a line:");
    out.push(ruler);
  }
  return out.join("\n");
}

/**
 * Lines that break the dialect's own rules.
 *
 * A cheap, local check that runs on what the model produced before the user is asked to accept it.
 * It cannot tell good RPG from bad RPG; it can tell a fixed-format member that a line overflows
 * column 80, which is the failure that wastes the most time because the compiler does not report
 * it — it truncates and compiles something else.
 */
export function checkIbmiSource(lang: IbmiLanguage, text: string): string[] {
  const problems: string[] = [];
  if (!lang.fixedForm) return problems;
  const limit = lang.id === "cobol" ? 72 : 80;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.length > limit) {
      problems.push(`line ${i + 1}: ${line.length} characters — the compiler stops at column ${limit}`);
    }
    if (lang.id.startsWith("dds") && line.trim() && line.length >= 6 && line[5] !== "A" && line[6] !== "*") {
      problems.push(`line ${i + 1}: column 6 must be A in DDS`);
    }
  });
  return problems.slice(0, 20);
}
