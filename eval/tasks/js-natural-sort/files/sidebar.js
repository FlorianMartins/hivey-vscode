import { sortEntries } from "./entries.js";

/**
 * What the sidebar renders. `state.entries` is kept most-recently-opened first, which is the order
 * the Recent panel shows.
 */
export function sidebarView(state) {
  return {
    explorer: sortEntries(state.entries).map((e) => e.name),
    recent: state.entries.filter((e) => e.type === "file").slice(0, 5).map((e) => e.name),
  };
}
