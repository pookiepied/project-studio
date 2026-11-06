import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

  readIcon(name: string): { readonly svg: string; readonly fetchedAt: number } | undefined {
    try {
      const file = join(this.#dir, name);
      const fetchedAt = statSync(file).mtimeMs;
      return { svg: readFileSync(file, "utf8"), fetchedAt };
    } catch {
      return undefined;
    }
  }

  writeText(name: string, text: string): void {
    try {
      this.#ensure();
      writeFileSync(join(this.#dir, name), text, "utf8");
    } catch {
      // A read-only cache must not hide an icon the source just supplied.
    }
  }

  removeIcon(name: string): void {
    try {
      rmSync(join(this.#dir, name), { force: true });
    } catch {
      // The cache is disposable and may be read-only.
    }
  }

  readJson<T>(name: string, isValid: (value: unknown) => value is T): T | undefined {
    try {
      const text = readFileSync(join(this.#dir, name), "utf8");
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
