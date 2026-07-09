/**
 * A conversation "turn" is anchored at the first message and at every user
 * message. This keeps the ConversationRail and the message list in agreement
 * about where turns begin, and stays correct under deletion:
 *   - deleting a user message removes that turn's anchor (rail reflows);
 *   - deleting an assistant reply keeps the turn (the question still anchors it);
 *   - a conversation that starts with — or is left with — an orphaned assistant
 *     message still gets an anchor, so no content is unreachable from the rail.
 *
 * Returns the message indices that start a turn, in order.
 */
export function getTurnAnchorIndices(messages: { role: string }[]): number[] {
  const anchors: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === 0 || messages[i].role === "user") anchors.push(i);
  }
  return anchors;
}
