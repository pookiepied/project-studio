/**
 * Which conversations are writing their closing message.
 *
 * When the person stops a run through the question card, the model gets one
 * turn to say why it stopped and what it needs - and then the run ends. The
 * "then it ends" half is enforced at the runtime seam where every tool result
 * is handed to Flue: once a conversation is armed, every further tool call in
 * that run is refused and marked terminating, so the loop ends after that
 * batch whether or not the model co-operates. A plain closing message (no
 * tool calls) ends the loop on its own; the arm only closes the door the
 * model would otherwise walk through again.
 *
 * The state lives per run - one instance is created beside the run's gate -
 * so it dies with the run and cannot leak into the next submission. That
 * lifetime is the whole design: "stop" applies to the run that was stopped,
 * and a run that outlives its own stop is precisely the bug this refuses.
 *
 * It sits in `execution/` beside the run's other lifecycle facts, not in
 * `tools/`: it is state the runtime holds and the ask tool only reports into,
 * and a tool module the runtime has to import is a tool module the runtime
 * can reach around the gate.
 */
export class ClosingTurns {
  readonly #armed = new Set<string>();

  /** Holds the door: the conversation's run is past its last working call. */
  arm(conversationId: string): void {
    this.#armed.add(conversationId);
  }

  /**
   * Whether a call in this conversation would run past a stop.
   *
   * Checked before every call the runtime admits, so a tool the model names
   * in its closing turn is answered with a result saying it did not run,
   * never executed and explained afterwards.
   */
  isArmed(conversationId: string): boolean {
    return this.#armed.has(conversationId);
  }
}
