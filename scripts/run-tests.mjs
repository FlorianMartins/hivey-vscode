// Run the unit tests on every Node this project claims to support.
//
// `node --test dist-tests/` looked like the obvious call and is not portable. What a positional
// argument MEANS to the test runner changed between releases: a directory under Node 18 and 20, a
// path or a glob under Node 22, where the set it matches is not the same one. And a literal glob is
// not an answer either — Node 18 has no glob support, and npm runs scripts through `cmd.exe` on
// Windows, which does not expand one, so the pattern would arrive at Node as text on exactly the
// platform where it cannot be read.
//
// So the files are enumerated here and passed explicitly. An explicit list of paths has meant the
// same thing in every version of the runner, on every platform, and it is the one call that needs
// no version check.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { argv, execPath, exit } from "node:process";

const dir = argv[2] ?? "dist-tests";

/** Every compiled test, in a stable order so a failure is reported in the same place twice. */
function tests(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...tests(path));
    else if (entry.name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

const files = tests(dir);
if (!files.length) {
  console.error(`No compiled tests in ${dir}. Did the build run?`);
  exit(1);
}

// `execPath` rather than "node": the runner must be the Node that is running this script, not
// whichever one happens to be first on the PATH.
const run = spawnSync(execPath, ["--test", ...files], { stdio: "inherit" });
exit(run.status ?? 1);
