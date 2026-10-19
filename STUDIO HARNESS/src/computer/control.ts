import { ComputerError } from "./errors.js";
import type { ComputerSession } from "./session.js";

const INPUT_TOOLS = new Set(["move", "click", "drag", "mouse_button", "scroll", "type", "key", "hold_key", "open", "focus", "arrange", "act", "set_value", "select_text", "read_ui", "clipboard"]);

/** The desktop is shared even when each conversation has its own driver. */
export class DesktopControl {
  #owner: ComputerSession | undefined;
  #tail: Promise<void> = Promise.resolve();

  run<T>(session: ComputerSession, tool: string, operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(async () => {
      if (INPUT_TOOLS.has(tool.replace("studio_computer_", ""))) {
        if (this.#owner !== undefined && this.#owner !== session && (this.#owner.running || this.#owner.releasing)) {
          throw new ComputerError("refused", { message: "Another conversation is using the desktop. Stop computer use there or wait for its idle driver to close, then observe the desktop again. No input was sent." });
        }
        this.#owner = session;
      }
      return operation();
    });
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }
}
