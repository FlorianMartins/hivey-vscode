import { validateNewUser, validatePatch } from "../model/user.js";
import type { UserStore } from "../store.js";
import { toJson } from "./serialize.js";

export interface Request {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}

export interface Response {
  status: number;
  body: unknown;
}

const ONE = /^\/users\/(\d+)$/;

/** The /users routes. The HTTP server in production only parses JSON and calls this. */
export function handle(store: UserStore, req: Request): Response {
  if (req.path === "/users" && req.method === "GET") {
    return { status: 200, body: store.list().map(toJson) };
  }

  if (req.path === "/users" && req.method === "POST") {
    const result = validateNewUser(req.body);
    if (!result.ok) return { status: 400, body: { errors: result.errors } };
    return { status: 201, body: toJson(store.create(result.value)) };
  }

  const match = ONE.exec(req.path);
  if (match) {
    const id = Number(match[1]);
    if (req.method === "GET") {
      const user = store.get(id);
      return user ? { status: 200, body: toJson(user) } : { status: 404, body: { error: "not found" } };
    }
    if (req.method === "PATCH") {
      const result = validatePatch(req.body);
      if (!result.ok) return { status: 400, body: { errors: result.errors } };
      const user = store.update(id, result.value);
      return user ? { status: 200, body: toJson(user) } : { status: 404, body: { error: "not found" } };
    }
  }

  return { status: 404, body: { error: "not found" } };
}
