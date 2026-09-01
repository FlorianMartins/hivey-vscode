// Downloads a real VS Code, launches it headless with this extension loaded, and runs the suite in
// `suite/`. It is the only test that proves `activate()` works: everything else runs in Node, where
// a missing contribution point or a bad activation event cannot fail.

import { runTests } from "@vscode/test-electron";
import { resolve } from "node:path";

async function main(): Promise<void> {
  try {
    await runTests({
      // `dist-integration/runTest.js`, so one level up is the repository — not two.
      //
      // It said `../../`, which is the repository's PARENT. VS Code does not fail on a development
      // path with no extension in it: it scans for nested ones, finds this repository, and caches
      // the extension description it resolves. Everything appeared to work, and the cached
      // description is what the screenshots were being taken of — so a change to the panel could be
      // built, be present in the bundle, and not be on the picture, with nothing anywhere saying
      // why. A wrong path that still works is worse than one that does not.
      extensionDevelopmentPath: resolve(__dirname, ".."),
      extensionTestsPath: resolve(__dirname, "./suite/index.js"),
      // No workspace, no telemetry, no other extension: whatever fails here is ours.
      launchArgs: [
        "--disable-extensions",
        "--disable-gpu",
        "--disable-telemetry",
        // HIVEY_CODE_LOCALE=fr runs the whole suite in a French editor, which is the only way to prove
        // the translation reaches a real user rather than only a unit test.
        ...(process.env["HIVEY_CODE_LOCALE"] ? ["--locale", process.env["HIVEY_CODE_LOCALE"]] : []),
      ],
    });
  } catch (err) {
    console.error("Integration tests failed:", err);
    process.exit(1);
  }
}

void main();
