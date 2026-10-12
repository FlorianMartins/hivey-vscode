// Noticing that a machine the user controls is serving something new.
//
// `ollama pull` is a thing people do WHILE the editor is open, and so is adding a model to an
// internal proxy. The picker was built once when the panel woke up and then only when somebody
// pressed Refresh — a button nobody presses, because nobody knows a list is stale until they have
// failed to find what they just installed.
//
// The comparison is here rather than beside the timer because it has exactly one subtlety and that
// subtlety is easy to get backwards: the FIRST look is a baseline, not news. Written the other way,
// every window that opens rebuilds its model list once for nothing.

/**
 * Whether what the user's own sources serve has changed since the last look.
 *
 * @param seen what was there last time, or `undefined` before the first look.
 * @param now what is there this time.
 */
export function servedSetChanged(seen: readonly string[] | undefined, now: readonly string[]): boolean {
  // Nothing to compare against yet. Returning true here would be the defect described above.
  if (seen === undefined) return false;
  if (seen.length !== now.length) return true;
  // Order is not information: two runtimes answering in a different sequence is not a new model.
  const a = [...seen].sort();
  const b = [...now].sort();
  return a.some((id, i) => id !== b[i]);
}
