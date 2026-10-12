// Deliberately exhaustive: an unknown status is a bug, not a blank label.
export function label(status) {
  switch (status) {
    case "open":
      return "open";
    case "closed":
      return "closed";
    default:
      throw new Error(`no label for status ${status}`);
  }
}
