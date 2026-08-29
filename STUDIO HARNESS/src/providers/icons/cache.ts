import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The one place an icon or an index is written to disk.
 *
 * Every source needs the same four things -- read a file, write a file, read
 * a JSON index, write a JSON index -- and before this they each had their own
 * copy with slightly different error handling. One copy, so a source is only
 * the part that is actually different about it: where it fetches from and how
 * it decides an id is absent.
 *
 * Everything under here is derived and disposable. It lives in the Studio
 * home's `cache/` directory, is refetched after a TTL, and losing it costs
 * nothing but re-downloads. Nothing in here is authoritative and nothing in
 * here should ever be backed up.
 */
export class IconCache {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  /** A namespaced child, so two sources cannot collide on the same id. */
  child(name: string): IconCache {
    return new IconCache(join(this.#dir, name));
  }

  readText(name: string): string | undefined {
    const file = join(this.#dir, name);
    if (!existsSync(file)) return undefined;
    try {
      return readFileSync(file, "utf8");
    } catch {
      // A cache read that throws is a cache miss. There is no state worth
      // repairing here: the next fetch overwrites it.
      return undefined;
    }
  }

  writeText(name: string, text: string): void {
    this.#ensure();
    writeFileSync(join(this.#dir, name), text, "utf8");
  }

  readJson<T>(name: string, isValid: (value: unknown) => value is T): T | undefined {
    const text = this.readText(name);
    if (text === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      return isValid(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  writeJson(name: string, value: unknown): void {
    this.writeText(name, JSON.stringify(value));
  }

  #ensure(): void {
    if (!existsSync(this.#dir)) mkdirSync(this.#dir, { recursive: true });
  }
}
