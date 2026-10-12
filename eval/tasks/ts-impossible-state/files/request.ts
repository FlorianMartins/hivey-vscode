// The state of one request, as the panel sees it.

export interface Request {
  loading?: boolean;
  data?: string[];
  error?: string;
  done?: boolean;
}

export function render(request: Request): string {
  if (request.loading) return "loading…";
  if (request.error) return `failed: ${request.error}`;
  if (request.done) return (request.data ?? []).join(", ");
  return "";
}
