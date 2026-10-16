export interface User {
  id: number;
  name: string;
  email: string;
  /** E.164, e.g. +32470123456. Absent when the user gave none. */
  phone?: string;
  createdAt: string;
}

/** What a client may send to create a user. */
export interface NewUser {
  name: string;
  email: string;
  phone?: string;
}

/** What a client may send to change a user: any subset of the creatable fields. */
export type UserPatch = Partial<NewUser>;

export interface FieldError {
  field: string;
  message: string;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164: a plus, a country code that does not start with 0, at most fifteen digits in all. */
const E164 = /^\+[1-9]\d{1,14}$/;

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

function checkPhone(value: unknown, errors: FieldError[]): string | undefined {
  if (typeof value !== "string" || !E164.test(value)) {
    errors.push({ field: "phone", message: "phone must be in E.164 format, e.g. +32470123456" });
    return undefined;
  }
  return value;
}

export function validateNewUser(input: unknown): Validated<NewUser> {
  if (!isRecord(input)) return { ok: false, errors: [{ field: "", message: "body must be an object" }] };
  const errors: FieldError[] = [];
  const name = checkName(input["name"], errors);
  const email = checkEmail(input["email"], errors);
  const phone = input["phone"] === undefined ? undefined : checkPhone(input["phone"], errors);
  if (errors.length || name === undefined || email === undefined) return { ok: false, errors };
  return { ok: true, value: phone === undefined ? { name, email } : { name, email, phone } };
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
  if ("phone" in input) {
    const phone = checkPhone(input["phone"], errors);
    if (phone !== undefined) patch.phone = phone;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: patch };
}
