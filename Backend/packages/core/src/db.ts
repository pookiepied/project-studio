import { notFound } from "./errors.js";
import type { User } from "./types.js";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function table(name: string): string {
  // Table names are interpolated, not bound, so they must never be caller-supplied.
  if (!IDENTIFIER.test(name)) throw new Error(`unsafe table name: ${name}`);
  return name;
}

/**
 * Columns this class owns and a caller may never write.
 *
 * `user_id` is the ownership check itself. Without this guard it passes the
 * identifier test like any other column and lands in the SET list, next to the
 * WHERE clause that is supposed to protect it — so a caller could hand one of
 * their own rows to somebody else's account. The check being in the query is
 * only worth something if the column it checks cannot be assigned.
 */
function reject(values: Record<string, unknown>, cols: readonly string[], reserved: readonly string[]): void {
  if (cols.some((c) => !IDENTIFIER.test(c))) throw new Error("unsafe column name");
  for (const r of reserved) {
    if (r in values) throw new Error(`${r} is set by OwnedDb and cannot be assigned by a caller`);
  }
}

/**
 * Ownership-scoped D1 access.
 *
 * Every read and write carries `user_id = ?` in the WHERE clause, added here
 * rather than by the caller. There is deliberately no unscoped escape hatch on
 * this class: if the ownership check is a line you write, it is a line you can
 * one day forget. Tables reached through it MUST have a `user_id` column.
 *
 * Admin-wide reads belong in the auth or console worker, not here.
 */
export class OwnedDb {
  constructor(
    private readonly db: D1Database,
    private readonly userId: string,
  ) {}

  async find<T>(name: string, id: string): Promise<T | null> {
    const row = await this.db
      .prepare(`SELECT * FROM ${table(name)} WHERE id = ? AND user_id = ?`)
      .bind(id, this.userId)
      .first<T>();
    return row ?? null;
  }

  /** Same as `find`, but 404s instead of returning null. */
  async get<T>(name: string, id: string): Promise<T> {
    const row = await this.find<T>(name, id);
    if (!row) throw notFound();
    return row;
  }

  async list<T>(name: string, limit = 100, offset = 0): Promise<T[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM ${table(name)} WHERE user_id = ? ORDER BY rowid DESC LIMIT ? OFFSET ?`,
      )
      .bind(this.userId, limit, offset)
      .all<T>();
    return results;
  }

  async insert(name: string, values: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(values);
    // `id` is allowed here — setting a row's own id is what an insert is for.
    reject(values, cols, ["user_id"]);
    const all = [...cols, "user_id"];
    await this.db
      .prepare(
        `INSERT INTO ${table(name)} (${all.join(", ")}) VALUES (${all.map(() => "?").join(", ")})`,
      )
      .bind(...cols.map((c) => values[c] ?? null), this.userId)
      .run();
  }

  /** Returns false when the row does not exist or is not ours — same answer either way. */
  async update(name: string, id: string, values: Record<string, unknown>): Promise<boolean> {
    const cols = Object.keys(values);
    if (cols.length === 0) return false;
    // `id` too: the row was addressed by it, so reassigning it in the same
    // statement is never what the caller meant.
    reject(values, cols, ["user_id", "id"]);
    const res = await this.db
      .prepare(
        `UPDATE ${table(name)} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ? AND user_id = ?`,
      )
      .bind(...cols.map((c) => values[c] ?? null), id, this.userId)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async remove(name: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare(`DELETE FROM ${table(name)} WHERE id = ? AND user_id = ?`)
      .bind(id, this.userId)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
}

export const owned = (db: D1Database, user: User): OwnedDb => new OwnedDb(db, user.id);
