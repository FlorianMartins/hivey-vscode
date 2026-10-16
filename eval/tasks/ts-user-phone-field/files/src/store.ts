import type { NewUser, User, UserPatch } from "./model/user.js";

/** Users in memory. The production one is backed by Postgres and has the same interface. */
export class UserStore {
  private readonly users = new Map<number, User>();
  private nextId = 1;
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  create(input: NewUser): User {
    const user: User = {
      id: this.nextId++,
      name: input.name,
      email: input.email,
      createdAt: this.now().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }

  get(id: number): User | undefined {
    return this.users.get(id);
  }

  list(): User[] {
    return [...this.users.values()];
  }

  update(id: number, patch: UserPatch): User | undefined {
    const user = this.users.get(id);
    if (!user) return undefined;
    const next: User = {
      ...user,
      name: patch.name ?? user.name,
      email: patch.email ?? user.email,
    };
    this.users.set(id, next);
    return next;
  }
}
