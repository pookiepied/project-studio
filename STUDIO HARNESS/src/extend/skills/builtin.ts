import { GLOBAL_SCOPE, type ExtensionSelectionStore, type SelectionKey } from "../selection.js";

/**
 * The bundled skills that are on unless the person turns them off.
 *
 * Same rule as the built-in servers (`registerBuiltInServers`): the default is
 * written at the global scope only when nothing is recorded there yet, so a
 * person who switched one off stays switched off across restarts. Being on
 * costs one line in the skill list each turn; the instructions load only when
 * the model activates the skill.
 *
 * `visual-responses` is on because the system prompt's Visuals rule points at
 * it - a rule naming a skill that is off would send the model looking for
 * something it cannot load.
 */
export const DEFAULT_ON_SKILLS: readonly string[] = ["visual-responses"];

export function switchOnBuiltInSkills(selection: ExtensionSelectionStore): void {
  for (const extensionId of DEFAULT_ON_SKILLS) {
    const key: SelectionKey = { kind: "skill", extensionId, scope: GLOBAL_SCOPE };
    if (selection.decisionAt(key) === undefined) selection.set(key, true);
  }
}
