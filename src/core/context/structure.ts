// What changed in the repository's structure since its map was taken — said after the transcript,
// not by rebuilding the map.
//
// ⚠️ « optimiser le prompt cache de llama.cpp ». The map sits right after the system prompt, and it
// was rebuilt whenever a file appeared or disappeared: in agent mode, where the agent creates files
// itself, that was nearly every turn — and a self-hosted server then re-read the whole conversation,
// map onwards, at every question. The map now stays as it was taken; the files created or deleted
// since are listed in the message that follows the transcript, which is re-read anyway. Past
// `MAP_REBUILD_AFTER` changes the map is out of date enough to be taken again.

import { SKIPPED_DIRS } from "../agent/searchScope.js";

/** More files created or deleted than this since the map was taken: take it again. */
export const MAP_REBUILD_AFTER = 50;

export interface StructureChange {
  kind: "created" | "deleted";
  /** Relative to the workspace, with forward slashes. */
  path: string;
}

/** Changes under folders no map or search is about — dependencies, build output — are not the structure. */
export function isStructural(path: string): boolean {
  return !path.split("/").some((part) => SKIPPED_DIRS.includes(part));
}

/** The net effect of a list of changes, in order: a file created then deleted is neither. */
export function netChanges(changes: StructureChange[]): { created: string[]; deleted: string[] } {
  const state = new Map<string, "created" | "deleted">();
  for (const c of changes) {
    const before = state.get(c.path);
    if (before && before !== c.kind) state.delete(c.path);
    else state.set(c.path, c.kind);
  }
  const created: string[] = [];
  const deleted: string[] = [];
  for (const [path, kind] of state) (kind === "created" ? created : deleted).push(path);
  return { created: created.sort(), deleted: deleted.sort() };
}

/** The line that goes after the transcript, or "" when nothing changed. */
export function structureNote(net: { created: string[]; deleted: string[] }): string {
  if (!net.created.length && !net.deleted.length) return "";
  const parts: string[] = [];
  if (net.created.length) parts.push(`created: ${net.created.join(", ")}`);
  if (net.deleted.length) parts.push(`deleted: ${net.deleted.join(", ")}`);
  return `[Since the repository map above was taken — ${parts.join("; ")}.]`;
}
