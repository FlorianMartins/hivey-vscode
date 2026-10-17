// What a failing command most likely got wrong — said next to its output, so the model fixes the
// cause instead of trying the same thing again a little differently.
//
// ⚠️ « il a toujours des erreurs des commandes node ». Measured on the recorded agent runs: the
// commonest failure by far was `npx tsc` — which, with no TypeScript in the project, downloads an
// unrelated package that happens to be called `tsc` (2.0.4) and fails — followed by the model
// retrying ten variants of the same command. Every pattern here is a mistake with one known fix,
// recognised from the command AND its output, never guessed from one alone.

export interface HintInput {
  command: string;
  output: string;
  exitCode?: number;
  /** `process.platform` of the machine the command ran on. */
  platform: string;
}

interface Rule {
  when: (i: HintInput) => boolean;
  hint: string;
}

const RULES: Rule[] = [
  {
    // `npx tsc` without TypeScript installed: npm offers or installs the package literally named tsc.
    when: (i) =>
      /\bnpx\b[^\n]*\btsc\b/.test(i.command) &&
      !/-p\s+typescript|--package[= ]typescript/.test(i.command) &&
      /package was not found and will be installed: tsc@|npx canceled due to missing packages|tsc@2\.0\.4|This is not the tsc command you are looking for/i.test(i.output),
    hint:
      "`npx tsc` resolved to an unrelated npm package named `tsc`, not the TypeScript compiler. Use the " +
      "project's own compiler (`npx --no-install tsc …` after `npm install`, or the build/typecheck script in " +
      "package.json), or name the package: `npx -y -p typescript tsc --noEmit …`.",
  },
  {
    // cmd.exe has no single quotes: `node -e 'code'` passes the quotes through as text.
    when: (i) => i.platform === "win32" && /\bnode\s+(-e|--eval|-p|--print)\s+'/.test(i.command),
    hint:
      "This runs in cmd.exe, where single quotes are not quotes: `node -e '…'` passes them through as code. " +
      "Use double quotes (escape the inner ones as \\\") or, for anything longer than a line, write a .js file and run it.",
  },
  {
    // A Unix tool in cmd.exe.
    when: (i) =>
      i.platform === "win32" &&
      /is not recognized as an internal or external command|n'est pas reconnu en tant que commande interne/i.test(i.output),
    hint:
      "This runs in cmd.exe on Windows: Unix tools such as ls, cat, head, grep, rm or cp do not exist there. " +
      "Use dir, type, findstr, del or copy — or the read_file, list_files and search_text tools to read the project.",
  },
  {
    when: (i) => /Cannot use import statement outside a module|require\(\) of ES Module|ERR_REQUIRE_ESM/.test(i.output),
    hint:
      "The file's module format does not match how it is loaded: a file using `import` needs `\"type\": \"module\"` " +
      "in the nearest package.json or the .mjs extension, and a CommonJS file cannot `require()` an ES module. " +
      "Read package.json before changing either.",
  },
  {
    when: (i) => /ERR_MODULE_NOT_FOUND|Cannot find module/.test(i.output) && /\bnode\b|\bnpm\b|\bnpx\b/.test(i.command),
    hint:
      "A module could not be found. Check the path relative to the importing file (ES modules need the file " +
      "extension, e.g. `./util.js`), and for a package, that it is in package.json and installed — run `npm install` " +
      "rather than inventing another way to load it.",
  },
];

/** The hint for this failure, or undefined when the command succeeded or nothing is recognised. */
export function commandHint(input: HintInput): string | undefined {
  if (input.exitCode === 0) return undefined;
  for (const r of RULES) if (r.when(input)) return `[Hint: ${r.hint}]`;
  return undefined;
}
