export function label(status) {
  switch (status) {
    case "open":
      return "open";
    case "paused":
      return "paused";
    case "closed":
      return "closed";
    default:
      throw new Error(`no label for status ${status}`);
  }
}
