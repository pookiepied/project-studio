# Settings: what stays, what goes, what is missing

Written 2026-11-07, from reading each page and what stands behind it in the client
and the harness. Status means what a person can do today, not what the page says.

## Navigation

Settings keeps its side panel beside the page. The old panel listed all 23 pages and
had to scroll. It now lists the seven groups, and the open group shows its pages
beneath it, so it holds at most thirteen rows.

Clicking a closed group opens it at its first page with something on it, so Coding
opens on Environments rather than the empty Git page. Archived has one page, so its
row is that page. The open group follows the page on screen, so search and links
from elsewhere open the right group. Back at the top of the panel leaves Settings.

A one-column version, with a menu for Settings and for each group, was tried first
and dropped: the side panel keeps every group in reach while a page is open.

## Audit

| Page | Status | Decision |
|---|---|---|
| General | Works. | Keep. The "Undo history" row had no control and is removed. |
| Appearance | Works. | Keep. |
| Other devices | Works. | Keep. |
| Shortcuts | Placeholder. Shortcuts exist in code but cannot be listed or changed. | Keep, build later. Start with a read-only list. |
| Diagnostics | Works. | Keep. |
| Account | Placeholder. The harness has sign-in code, but no client page uses it. | Keep, build later. |
| Library | Works. | Keep. |
| Personalization | Placeholder. Nothing behind it. | Keep, build later. |
| Models, Media, Tools | Work. | Keep. |
| MCP servers | Works. | Keep. |
| Connectors | Placeholder. Nothing behind it. | Keep, build later. |
| Browser and computer use | Placeholder. The features work, but have no settings. | Keep, build later. |
| Permissions | Works, read and revoke only. | Keep. See below. |
| Skills, Agents, Commands | Work. Agents is read-only. | Keep. |
| Hooks | Placeholder. Nothing behind it. | Keep, build later. |
| Git | Placeholder. The agent has a git tool, but no setting reaches it. | Keep, build later. |
| Worktrees | Placeholder. Studio has no worktree feature. | Keep, build later. |
| Environments | Works. | Keep, with the changes below. |
| Archived chats | Works. | Keep. |

Eight of the 23 pages are placeholders. Each is dimmed in the side panel and named
as planned, so a page that does nothing no longer looks like one that works.

## Questions from the review

- **Permissions and Environments are different things.** Permissions lists approvals
  for actions, and can only revoke them. Environments decides which folders are in
  reach. Keep both, but the names do not make this clear.
- **Always allowing Downloads already exists.** In Environments, add a custom path
  with the scope set to Everywhere. It applies to every project and to conversations
  with no project. It is hard to find, which is a page design problem.
- **Shell choice is real.** The harness runs commands through the chosen shell, and
  the page offers only shells this machine has. Keep it.
- **The sandbox fence is real on Linux only.** Windows has none since ADR 0057. The
  row now shows only where a build offers one, so Windows no longer sees a row with
  nothing to do. The Linux code stays, and removing it is a separate decision.
- **"No projects yet" is correct.** This install has no projects. It is not a bug,
  but the empty state could offer Add a project.

## To build later, not now

1. **Voice page.** Microphone choice, input level, a dictation shortcut, and the voice
   model, which sits under Models today. `useMicInput` opens the default device only.
2. **Git page.** Branch prefix, pull request merge method, force push, draft pull
   requests, review delivery, commit and pull request instructions. The pull request
   rows need a pull request feature first.
3. **Worktrees page.** Root folder, fetch before creating, automatic cleanup, how many
   to keep, ask before deleting, and the list. This needs a worktree feature first.
4. **Environments split.** Separate pages for shell, folder access and per-project
   settings, with projects listed and an add button.
5. **Shortcuts, Personalization, Account, Connectors, Browser and computer use, Hooks.**

Suggested order: Voice and Shortcuts are the most contained, then Personalization.
Git and Worktrees need features behind them, so they are the largest.
