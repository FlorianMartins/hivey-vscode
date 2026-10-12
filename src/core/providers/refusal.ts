// A provider that refused is not a model that failed.
//
// ⚠️ The rule already existed for the LOCAL guard — a run whose budget cap stopped it is recorded as
// refused, and a task set containing one refusal states no pass rate at all — and it had a hole the
// size of the thing it was built for. A refusal from the PROVIDER was not recorded, so it looked
// exactly like a turn the model got wrong.
//
// The run that found it: 62 tasks, six at a time, and OpenRouter answered
//
//     HTTP 402: This request would exceed your available credits given your current
//     in-flight requests.
//
// to 54 of them — it holds credit for every request still in flight, and six concurrent agent turns
// on a million-token model reserve more than was left. The harness recorded 8 passes out of 62 and
// would have published **13 %** as this configuration's quality. Not a wrong number: a number about
// nothing.
//
// Matched on the message rather than on a status code, because that is what reaches this point: the
// providers are behind two wire formats and several gateways, and the one thing they all do is put
// it in the text. Deliberately narrow — only credit and rate limiting, which are the two ways a
// provider says "not now" rather than "no".

/** Does this error mean the provider would not serve the request, as opposed to failing it? */
export function isProviderRefusal(message: string): boolean {
  const text = (message ?? "").toLowerCase();
  if (/\b402\b|payment required|insufficient credit|exceed your available credits|add credits/.test(text)) return true;
  if (/\b429\b|too many requests|rate limit|quota exceeded/.test(text)) return true;
  return false;
}

/** Which kind, for the record. One word, because a report groups by it. */
export function refusalKind(message: string): "credit" | "rate" | undefined {
  const text = (message ?? "").toLowerCase();
  if (/\b402\b|payment required|insufficient credit|exceed your available credits|add credits/.test(text)) return "credit";
  if (/\b429\b|too many requests|rate limit|quota exceeded/.test(text)) return "rate";
  return undefined;
}
