# Report Template

Copy this structure exactly. Omit a section only by writing "None found." — never by
deleting the heading, because a missing heading is indistinguishable from a missed check.

---

# Audit Report — <slice id and name>

**Files read:** N of M in scope. If you did not read all of them, say which you skipped
and why. Do not claim coverage you do not have.

## 1. What this slice owns

Two paragraphs, maximum. What is this code actually responsible for, as opposed to what
its folder name suggests? Note any mismatch — that mismatch is a finding.

## 2. Structure

The real folder/file layout, and where it fights its own organizing principle. Files in
the wrong place. Folders whose contents share a name but not a purpose. Giant files
(cite line counts). Vague names (`utils`, `helpers`, `misc`, `common`).

## 3. Findings

The core of the report. One entry per finding, most severe first.

### F-<n> — <one-line statement of the defect>

- **Evidence:** `path/file.ts:123` (one per line; more than one if the pattern repeats)
- **What's wrong:** the defect, stated concretely
- **Why it matters:** the concrete consequence — what breaks, what confuses, what cannot
  be changed safely. If you cannot name a consequence, it is not a finding, it is a taste
  preference. Say so or drop it.
- **Confidence:** verified / probable / suspected
- **Category:** layering · error-handling · design-system · dead-or-duplicate ·
  boundary-violation · typing · naming · coupling · state · stale-doc · other

## 4. Boundary crossings

Every place this slice reaches outside its layer. Be exhaustive; this is the highest-value
section in the whole audit.

| From (file:line) | To | Direction | Legitimate? |
|---|---|---|---|

Direction means: does it invert the intended layering (`core/` → `features/`,
`runtime/` → `features/`, `ui/` → anything with business logic)? Legitimacy is your
judgment; mark it and justify in one clause.

Also list every call into Tauri / native / filesystem / shell, with file:line, and say
whether it sits behind a typed service or is inline in a component.

## 5. Error handling

How this slice handles failure. Every `console.error`, every raw `throw`, every toast,
every swallowed `catch {}`, every raw error string that can reach a user's eyes. Count
the distinct conventions in use. Cite them.

## 6. Design system usage

Hardcoded visual values, inline styles, ad-hoc class strings, duplicated tokens, direct
color values, anything bypassing the token system. Note where the slice does this
correctly too — we need to know what "right" already looks like here.

## 7. State and data flow

Where state lives, who owns it, what is duplicated across layers, what is derived and
re-derived, what is stored in the wrong place. Note prop drilling deeper than three
levels and any context used as a dumping ground.

## 8. Stale or lying documentation

Comments, TODOs, and doc blocks that contradict the code. Cite both the comment and the
code that disproves it. This repo has known instances; assume more.

## 9. What surprised you

Free-form, short. The thing you did not expect. Often the most useful section in the
report — a fresh reader notices what a maintainer has stopped seeing.

## 10. What you did not check

Explicit. Files skipped, questions you could not answer, things you would need to run the
app to know. **This section is mandatory and may not be empty.** An audit that claims
total coverage will be treated as untrustworthy in full.
