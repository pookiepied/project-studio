# Task 41 - One column at a time

Settings currently shows **two navigation columns at once**: the app sidebar
on the far left (`AppShell` renders `<Sidebar />` on every route) and the
settings rail inside the page (`features/settings/SettingsNav.tsx`). This
task makes the left column hold exactly one list at a time.

The decision, already taken: **entering Settings replaces the conversation
list with the settings tree, in the same column.** Leaving restores it. There
is never a second nav column.

---

## Why, so the change is not undone later

`SettingsNav.tsx`'s own docblock records that this was argued twice - a rail
existed, was removed as "two lists of destinations and neither is obviously
in charge", then returned because sixteen sections in one scroll is not an
answer either. Both objections were right. The rail won on navigation and
then had to spend a paragraph on visual devices - no fill, no border, a
sliding chip - making two columns *feel* like not-two-columns.

This resolves it structurally instead: the settings tree **is** the sidebar's
content while in Settings, so there are never two lists to rank. Update that
docblock to record the resolution rather than leaving an argument for a
layout that no longer exists.

The left column's meaning becomes explicit and should be written down where
the sidebar is defined: **it holds where you can go, one list at a time.**

---

## What to build

**The sidebar swaps.** On the `settings` route, the column shows the settings
tree - the same `SETTINGS_GROUPS` data, groups and all - instead of
conversations and projects. Everything else about the column stays: its
width, its ground, its header treatment, the window drag region.

**A way back, and only one.** An explicit control at the top of the tree
returns to what the user was doing. Decide and state what "back" means: the
conversation they came from, or home. Whichever you choose, it must be the
same every time - a back that sometimes lands somewhere else is worse than a
back that always goes home.

**The in-page rail goes.** `SettingsNav` as a second column is deleted;
`SettingsPage` becomes a single-column document rendering the active section.
If the moving-chip selection is worth keeping, it moves with the tree into
the sidebar; do not leave a second copy behind.

**The closed-sidebar case, which is the one that will bite.** The sidebar is
open-or-gone with no icon rail, and `Ctrl ,` opens Settings directly. So
Settings can be entered with the column closed, and under this design the
column is now the only way to navigate Settings. Opening Settings must
therefore open the column. Leaving Settings should restore the state the user
had before - a sidebar they had deliberately closed should not be forced open
afterwards.

**Compact layout.** The column behaves as a drawer at narrow widths
(`useCompactLayout`). The swap must work there too, and the report should say
what the compact experience actually is.

**Nothing else moves.** The route model
(`{ kind: 'settings', sectionId }`) is unchanged, `Ctrl ,` and the command
palette still reach sections by name, and no section's content changes.

---

## What is lost, and what is not compensated for

Conversations leave the screen while in Settings, so a streaming turn is no
longer visible in the list. **That is accepted for now and must not be
patched around in this task** - no status row bolted above the settings tree,
no half-sidebar. If the loss proves to matter in use, the answer is a status
in the top strip (which already has `ActivityMark` and the running set), and
that is a separate decision.

State plainly in the report what a person now cannot see while in Settings.

---

## Explicitly not this task

Where project and conversation settings belong (they are not global settings
and the tree should not grow to hold them - a separate decision). Any new
settings section. Any change to a pane's contents. The top-strip status
above.

---

## Constraints

- No `any`, no non-const `as`, no non-null `!`.
- UTF-8, no BOM, LF. Em dash in comment prose only; no en dashes, smart
  quotes, curly apostrophes, ellipsis characters, or emoji in source.
- Never leave a green placeholder test.
- Edit by hand, never with a script.
- Forbidden: `git checkout`, `git switch`, `git stash`, `git reset`,
  `git clean`, `git commit`, `git rebase`. `Backend/`, `docs/`, `prompts/`
  and `report/` are the user's - read, never modify, never `git add`.
- The working tree holds uncommitted work that is not yours. Change only what
  this task names.

## Verification

- `npm run typecheck` in `STUDIO`, clean.
- The STUDIO vitest suite: zero failures and zero unhandled errors. Report
  the count.
- Drive the built app. Screenshots of: a conversation with the sidebar open,
  the same window in Settings, and the return. Plus the compact width.

## Report

`report/TASK-41-one-column-at-a-time.md`:

- What "back" means and why.
- What happens to the sidebar's open/closed state on entering and leaving.
- The compact behaviour.
- What a person can no longer see while in Settings.
- Screenshots.
- Every place this brief was wrong. Task 38's section 9 is the standard.
