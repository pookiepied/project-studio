# Task 54 - What the tool actually tells you

Five fixes to the native tools, all of the same shape: the tool knows
something the model needs and does not say it, or says something that is not
true of this machine.

This brief was written for a delegate session, implemented, committed as
`ef00cf0`, and lost with the drive on 2026-09-04 before it was pushed. It was
reapplied directly on 2026-09-05. The text is kept because `prompts/` is the
record of why each change was made, not because another session will run it.

## Part 0 - The measured facts

Command separators are not universal, and the harness read them as if they
were. Measured on this machine (Windows 11 Home, no PowerShell 7):

| Interpreter | Separators it honours |
|---|---|
| pwsh (PowerShell 7) | `;` `&&` `\|\|` - documented, not measured; not installed here |
| bash (Git for Windows) | `;` `&` `&&` `\|\|` |
| cmd.exe | `&` `&&` `\|\|` - **no `;`** |
| Windows PowerShell 5.1 | `;` - **no `&&`, no `\|\|`**; `&` is the call operator |
| /bin/bash, /bin/sh | `;` `&` `&&` `\|\|` |

Two consequences, both live before this task:

- On `cmd.exe`, `git status; git push` is one command with a stray argument.
  The reader named two programs and the user approved a push that never ran.
- On 5.1, `npm test && npm run build` is a syntax error the user was asked to
  approve first.

## Part 1 - Separators are per interpreter

`Interpreter` carries a measured `separators` field. `readCommandPrograms`
takes the interpreter and splits only on what it honours. A separator the
interpreter does not honour is refused at parse time, naming the interpreter
and the separator to write instead. Quoting is resolved before any separator
branch, so a separator inside quotes is content.

## Part 2 - The descriptor names the shell

The shell descriptor is built from the resolved interpreter and splices in the
same `statement` the environment block uses. It used to offer
`npm run build && node check.js` as its example on every machine, including the
two Windows fallbacks that cannot run it.

## Part 3 - `edit` returns the changed region

An edit is a blind write, and every edit was followed by a read of the same
file to see the seam. The changed region comes back with its line numbers,
three lines of context each side, merged where windows touch, capped by region
count and by total lines.

## Part 4 - `write` names directories it created

`Created src/componets/Button.tsx` is a success report for a typo, and the
typo becomes a directory that exists. The directories that were not there a
moment ago are named.

## Part 5 - `read` states its own defaults

2000-line window, 2000-character line truncation, 1 MB file limit, in the
descriptor, so a model asks for the right window on the first call.

## Not this task

`web_search` and `fetch` (provider-key issues), subagents, planning and todo
tools. An `fs` tool over the existing `sandbox.mkdir`/`sandbox.remove`,
render-to-PNG for visual QA, and a capabilities probe are all deferred.

## Verification

Every load-bearing test gets a negative control. The separator table is bound
by a test against the live resolved interpreter, because fixtures carry their
own copies of the values and cannot catch a broken row.
