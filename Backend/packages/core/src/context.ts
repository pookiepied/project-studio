import type { Tracker } from "./telemetry.js";
import type { Identity, Session, User } from "./types.js";
import { OwnedDb } from "./db.js";

export interface BaseContext<Env> {
  env: Env;
  url: URL;
  requestId: string;
  track: Tracker;
  waitUntil(promise: Promise<unknown>): void;
}

/** What a protected handler receives. `user` is always present — that is the point. */
export interface AppContext<Env> extends BaseContext<Env> {
  user: User;
  session: Session;
  /** Ownership-scoped view of a D1 database. The only sanctioned way to read user data. */
  owned(db: D1Database): OwnedDb;
}

export function toAppContext<Env>(base: BaseContext<Env>, id: Identity): AppContext<Env> {
  return {
    ...base,
    user: id.user,
    session: id.session,
    owned: (db) => new OwnedDb(db, id.user.id),
  };
}
