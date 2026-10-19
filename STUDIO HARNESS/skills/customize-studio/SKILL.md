---
name: customize-studio
description: How to change what this installation of Project Studio can reach - adding, switching, diagnosing, repairing or removing an MCP connection through the Studio Customization tools, and how Studio's own skills are switched on. Use when the work is about Studio's own connections or capabilities rather than the person's project.
---

Studio keeps two things apart, and almost every customization question
becomes simple once they stay apart: what is **installed** (a connection
exists, with its address, its command and its secret), and what is
**switched on** (who gets it - a conversation, a project, or every
conversation). Installing never implies enabling, and a switch never grants
anything: every call still goes through the permission kernel exactly as it
would without any of this.

## The tools, and the shape of the work

All of this runs through the **Studio Customization** connection tools. They
load through `discover`: use `action: "load"`, `server: "mcp:studio-customization"`
and `tools: "all"`, or an array of the exact tool names you need. They are
callable from your next model step.

`add_connection` installs and switches on in one call. Three ways in:

- **By address** - a remote MCP server: its `url`, its `auth` (none, bearer,
  or a named header), and its `secret` if it keeps one. Nothing is
  downloaded; the harness makes the requests itself.
- **By package** - an npm name. The package is downloaded into this
  installation's own `tools/` tree and launched by its single binary entry.
  This runs under the harness's own authority, so no permissions change
  hands; it also needs this installation to carry npm, and says so when it
  does not.
- **By command** - a program already on this machine, given by its
  **absolute** path. Resolve the name with your own shell first (`where` on
  Windows, `which` elsewhere); the record keeps the absolute path, never a
  name or a shim.

Give every connection its `description` - one sentence saying what it is
*for*. That sentence is what every conversation is told; a connection
described only by its product name has not actually been described.

The switch it gets by default is the user's default - *everywhere* - because
the ask was explicit: somebody asked for this connection to exist, not for
one conversation to see it. Narrow it with `scope: "conversation"` for this
conversation's switch only, or `scope: "project"` (it needs the project's
id) for everything under one project.

## Scopes, and the third answer

A switch lives at one of three scopes, resolved narrowest-first:
**conversation**, then **project**, then the **user's default**. Absence at
a scope means *no opinion here*, not *off* - which is why `set_connection`
knows three states:

- `on` / `off` - a real decision at that scope. A narrow `off` overrides a
  wider `on`, and that is the whole point of choosing it.
- `inherit` - removes this scope's opinion so the wider one applies again.
  Inherit is *not* the same as off, and the tool's answer states what now
  applies rather than what was stored, because the two are easy to confuse
  and leave the conversation with different reach.

The switch and the process are different facts: the process comes up for a
connection that a project or the user's default enables, while the
conversation switch only governs what this conversation's own tool array
resolves. That is why `add_connection` defaults to *everywhere* - the ask
was explicit - and narrowing afterwards is one `set_connection` away.

Studio's own connections - the Browser, the Computer - cannot be removed or
edited; they are switched, like everything else. Their answer explains this
when you try.

## Time, and failure

A freshly added connection starts in the background. Its tools do not exist
for you until it is up: `connection_status <id>` says when it is ready - or
why it is not, in the connection's own words, alongside what its process
printed. Browse it with `discover` and `server: "mcp:<id>"`, then load the
tools you need with `action: "load"` and a `tools` array.
`restart_connection` stops one and lets the harness start it straight back;
`set_connection` with a new `secret` does that walk itself, because secrets
are read at launch.

Secrets live in this machine's credential store, never in the conversation
and never in the record - the record holds only the *name* of the
environment variable a local connection reads its key from.

`remove_connection` uninstalls completely: the record, the approvals, the
key, the decisions at every scope, and anything downloaded.

## Skills, the other half of this

Skills are folders in the person's own Studio home, switched on per project
from the settings. They are outside your working directory, and you cannot
write there: when asked to create one, produce the files and let the person
put them in place - the **create-skill** skill, when it is on, walks that
format. Skills never change what you may do; every tool they mention is
checked exactly as it would be without them.
