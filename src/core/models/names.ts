// How a model is named on screen.
//
// Separate from the extension layer for the reason everything else in core is: it is a pure
// decision about a string, and a pure decision that cannot be tested is a decision nobody can
// check. It moved here the moment a test tried to import it and pulled the whole `vscode` API in
// behind it.

/**
 * A model name short enough for a control that shares a row with three others.
 *
 * `anthropic/claude-sonnet-4.5` and `qwen2.5-coder:7b` both carry information the composer does not
 * need: the vendor is repeated in the picker, and the size tag is a deployment detail. What is left
 * is the part someone would say out loud. The full id stays in the tooltip and in the picker, so
 * nothing is lost — only the row is spared.
 *
 * Never returns an empty string. A button whose label vanished is a button the user reports as
 * missing, which is exactly what happened when the label was allowed to shrink to nothing.
 */
export function shortModelName(name: string): string {
  const withoutVendor = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  const withoutTag = withoutVendor.replace(/:[\w.-]+$/, "");
  return withoutTag || withoutVendor || name;
}
