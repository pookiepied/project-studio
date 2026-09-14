/**
 * A wait, for every page but the conversation: nothing drawn.
 *
 * A list, a pane or a column that is still being read shows its frame and
 * its title and no rows, and the rows arrive. The reads here are to a
 * process on this machine and land in a few frames; anything drawn for
 * those frames is a flash that says "loading" about something already
 * loaded, and anything drawn for a longer wait - bars shaped like the rows,
 * a mark, a ring, dots - was tried and refused for what it was on a page of
 * settings: a widget where content should be. The conversation is the one
 * surface with a wait of its own (`TranscriptWait`, the bobbing dots),
 * because a history can be long, and a long empty page needs to say it is
 * coming.
 *
 * What remains is the announcement: `role="status"` with a spoken label,
 * so a screen reader hears that the region is loading while a sighted
 * reader sees the frame fill in.
 */
export function Loading({ label }: { label: string }) {
  return <span role="status" aria-label={label} className="sr-only" />
}
