import { AppSettings, type NamespacedSettings } from "../storage/app-settings.js";
import type { StudioDatabase } from "../storage/database.js";
import { preferInterpreter, type InterpreterKind } from "./interpreter.js";

/**
 * Which shell the person wants the shell tool to run lines through.
 *
 * ADR 0057: the shell is the person's shell. `interpreter.ts` measures what
 * the machine has and orders it; this remembers the one the person picked,
 * across runs, and tells the running process about it. One key, one
 * namespace, and the value is the interpreter's kind rather than its path:
 * a path is a fact about one machine on one day, a kind is what the person
 * meant, and the measurement finds the path again.
 *
 * A stored kind the machine no longer has is kept rather than cleared - the
 * order answers meanwhile, and `shellChoice` reports the preference as not
 * in effect, so the settings page can say so instead of quietly forgetting
 * what was asked for.
 */

const KEY = "interpreter";
const KINDS: readonly InterpreterKind[] = ["pwsh", "bash", "powershell", "cmd", "sh"];

function isKind(value: string): value is InterpreterKind {
  return (KINDS as readonly string[]).includes(value);
}

export class ShellSettingsStore {
  readonly #settings: NamespacedSettings;

  constructor(db: StudioDatabase) {
    this.#settings = new AppSettings(db).namespace("shell");
  }

  /** The stored preference, or undefined for "whatever the machine orders first". */
  read(): InterpreterKind | undefined {
    const stored = this.#settings.get(KEY);
    return stored !== undefined && isKind(stored) ? stored : undefined;
  }

  /** Records the choice and applies it to this process. `undefined` clears it. */
  select(kind: InterpreterKind | undefined): void {
    if (kind === undefined) this.#settings.clear(KEY);
    else this.#settings.set(KEY, kind);
    preferInterpreter(kind);
  }

  /** Applies what is stored to this process, at startup. */
  apply(): void {
    preferInterpreter(this.read());
  }
}
