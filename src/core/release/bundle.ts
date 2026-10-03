// The one bundle the repository's own scripts import.
//
// `scripts/*.mjs` cannot import TypeScript, and the rules those scripts enforce — what a report may
// claim, what a submission is refused for — are exactly the rules that need unit tests. So they live
// in `core` and this re-exports them into a single `dist/eval-report.mjs`.
//
// One bundle rather than one per script: two bundles built from overlapping sources can disagree
// about what they share, and nothing would say which one a script was reading.

export * from "../eval/report.js";
export * from "../release/preflight.js";
export { listZipEntries, readZipEntry } from "../docs/zip.js";
