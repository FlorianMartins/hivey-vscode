export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

/** What a client may send to create a user. */
export interface NewUser {
  name: string;
  email: string;
}

/** What a client may send to change a user: any subset of the creatable fields. */
export type UserPatch = Partial<NewUser>;

export interface FieldError {
  field: string;
  message: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function checkName(value: unknown, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ field: "name", message: "name is required" });
    return undefined;
  }
  return value.trim();
}

function checkEmail(value: unknown, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" || !EMAIL.test(value)) {
    errors.push({ field: "email", message: "email must be a valid address" });
    return undefined;
  }
  return value.toLowerCase();
}

export function validateNewUser(input: unknown): Validated<NewUser> {
  if (!isRecord(input)) return { ok: false, errors: [{ field: "", message: "body must be an object" }] };
  const errors: FieldError[] = [];
  const name = checkName(input["name"], errors);
  const email = checkEmail(input["email"], errors);
  if (errors.length || name === undefined || email === undefined) return { ok: false, errors };
  return { ok: true, value: { name, email } };
}

export function validatePatch(input: unknown): Validated<UserPatch> {
  if (!isRecord(input)) return { ok: false, errors: [{ field: "", message: "body must be an object" }] };
  const errors: FieldError[] = [];
  const patch: UserPatch = {};
  if ("name" in input) {
    const name = checkName(input["name"], errors);
    if (name !== undefined) patch.name = name;
  }
  if ("email" in input) {
    const email = checkEmail(input["email"], errors);
    if (email !== undefined) patch.email = email;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: patch };
}
