import type { User } from "../model/user.js";

/** The public shape of a user. Listed field by field so an internal column never leaks out. */
export interface UserJson {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  createdAt: string;
}

export function toJson(user: User): UserJson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    createdAt: user.createdAt,
  };
}
