# Handoff — item 003.5, part A: the destination guard

You are working in the repository at `C:\pookiepied\Project Studio`.
All the code you touch is under `STUDIO HARNESS/`.

This is a **bounded task**. Do exactly what is listed below. Do not do the rest
of Phase 11, do not start the HTTP client, do not touch MCP.

---

## 0. Rules you must follow

These are not preferences. Work that breaks one of them is rejected.

1. **Do not write batch files, PowerShell scripts, or shell scripts that edit
   source code.** Do not write a script that does search-and-replace across
   files. Edit every file by hand, with a normal editor tool, one edit at a
   time. Scripted edits have corrupted this codebase before.
2. **ASCII only in source files.** No emoji. No smart quotes, no en-dashes, no
   curly apostrophes. Plain `'`, `"`, and `-`. Files are UTF-8 with no BOM and
   LF line endings.
3. **Do not reformat code you are not changing.** No import reordering, no
   whitespace cleanups, no "while I was here" fixes. The diff must contain only
   this task.
4. **Do not add a dependency.** Not one. Node's standard library only.
5. **TypeScript is strict.** No `any`, no `as` casts to escape a type, no
   non-null `!`. If you need a type, write it.
6. **Do not delete or weaken an existing test.** If a test fails, either your
   change is wrong, or the test's meaning genuinely moved -- and if it moved,
   say so in your report and explain why. Do not silently rewrite it.

## 1. Read these first, in this order

Do not write any code until you have read all of these.

| File | Why |
|---|---|
| `STUDIO HARNESS/src/net/destination.ts` | The file you are changing. |
| `STUDIO HARNESS/tests/unit/net-destination.test.ts` | Its existing tests. Match their style exactly. |
| `STUDIO HARNESS/docs/decisions/0022-a-network-effect-is-a-destination.md` | The rule this file implements. |
| `STUDIO HARNESS/src/retrieval/http.ts` | The only current caller shape. Read it; do not change it. |
| `STUDIO HARNESS/src/tools/web/fetch.ts` | The other caller. Read it; do not change it. |
| `STUDIO HARNESS/docs/KNOWN-ISSUES.md` | So you do not re-report something already known. |
| `tasks/003-phase-11-work-plan.md`, section `003.5` | The item you are doing. |
| `tasks/002-phase-11-mcp.md`, section 9 | The design behind it. |

Read `STUDIO HARNESS/CLAUDE.md` if it exists, and follow it.

## 2. What is wrong today

`isPrivateHost(host)` takes a host and no port -- `src/net/destination.ts:123`.

Two things need a port and therefore cannot be expressed today:

- **The own-ports rule.** STUDIO listens on its own local ports. The agent must
  never be able to reach them, even in a future where some loopback is allowed.
  A rule about `127.0.0.1:7331` cannot be written against a function that only
  sees `127.0.0.1`.
- **The permission resource.** For a loopback destination the resource has to be
  host *and* port. `localhost:3000` and `localhost:9999` are different
  destinations and approving one must not approve the other.

## 3. What to build

### 3.1 A port-aware check

Add a second function. **Do not change `isPrivateHost`'s signature** -- callers
depend on it and a host-only answer is still the right answer to a host-only
question.

```ts
/** A destination that has been parsed but not yet judged. */
export interface HostPort {
  readonly host: string;
  /** Already defaulted from the scheme: 80 for http, 443 for https. */
  readonly port: number;
}
```

Write a classifier that returns *why* a destination is refused, rather than a
boolean:

```ts
export type HostClass =
  | "public"      // ordinary internet
  | "loopback"    // this machine
  | "private"     // this network, link-local, metadata, multicast, reserved
  | "own-port";   // one of our own listening ports
```

`loopback` and `private` are split because a later caller is allowed to treat
loopback differently. `parseDestination` must still refuse **all three**
non-public classes today, with the same `"private"` refusal kind and the same
message. **This task changes no behaviour that anyone can observe.** It only
makes a distinction expressible.

`own-port` is refused even if loopback is ever allowed. It is never grantable
and never offered.

### 3.2 The own-ports registry

A tiny module -- put it in `src/net/own-ports.ts`.

It records ports this process listens on, and answers whether a port is one of
them. Requirements:

- A port can be registered and unregistered. Something that stops listening must
  be able to say so.
- Registering the same port twice is not an error.
- It is process-local state. Do not put it in SQLite -- a listening socket is
  live state and this codebase's rule is that live state is never durable.
- Nothing registers a port yet. That is expected and correct. Do not go looking
  for the server code and wire it up; that is a later item.

Write the module so the *check* is complete even though the registry is empty.

### 3.3 The resource string

Add an exported function that turns a `HostPort` into the permission resource:

- Public host: the host alone, lowercase. `docs.example.com`. Unchanged from
  today.
- Loopback: host and port. `localhost:3000`.

Keep it one function so the two spellings can never drift apart.

## 4. Tests

New tests go in `STUDIO HARNESS/tests/unit/net-destination.test.ts` unless the
own-ports registry deserves its own file, in which case add
`tests/unit/own-ports.test.ts`.

Cover at least all of this. Each line is at least one test.

**Classification**
- `example.com:443` -> `public`
- `127.0.0.1:3000` -> `loopback`
- `localhost:3000` -> `loopback`
- `::1` -> `loopback`
- `[::ffff:127.0.0.1]` -> `loopback` (note: `new URL` rewrites this to
  `[::ffff:7f00:1]`; both spellings must classify the same)
- `10.0.0.5`, `192.168.1.1`, `172.16.0.1`, `172.31.255.255` -> `private`
- `172.15.0.1` and `172.32.0.1` -> `public` (the boundaries of that range are a
  classic off-by-one; test both sides)
- `169.254.169.254` -> `private` (cloud metadata; the highest-value target)
- `100.64.0.1` -> `private`
- `224.0.0.1` -> `private`
- `foo.local`, `foo.internal`, `foo.home.arpa` -> `private`
- Trailing dot: `example.com.` classifies the same as `example.com`
- Case: `EXAMPLE.COM` classifies the same as `example.com`

**Ports**
- Default port is filled from the scheme: `http://example.com` gives 80,
  `https://example.com` gives 443
- An explicit port survives: `http://example.com:8080` gives 8080

**Own ports**
- A registered port on loopback classifies `own-port`, not `loopback`
- The same port number on a *public* host is still `public` -- the rule is about
  our machine, not about the number
- After unregistering, it classifies `loopback` again

**Resource**
- A public host's resource has no port
- A loopback resource has the port
- Two different loopback ports produce two different resources

**No behaviour changed**
- `parseDestination` still throws `DestinationError` with kind `"private"` for
  every non-public case, including `own-port`
- Every existing test in the file still passes, unmodified

## 5. Verification, and this part is not optional

For each new rule you added:

1. Write the test.
2. Break the code the test covers -- delete the line, invert the condition.
3. Run the test and **confirm it fails**.
4. Restore the code.

A test that passes against broken code is worse than no test. If a test of
yours still passes in step 3, it is testing nothing; fix it or say so.

Then run the full check from `STUDIO HARNESS/`:

```
pnpm check
```

If pnpm asks something interactively on this machine, use `CI=true pnpm check`.
It must be green. Report the passing count before and after.

## 6. Comment style, which this codebase cares about

Read the comments in `destination.ts` before you write any. The pattern:

- Comments say **why**, never what. `// loopback` above a loopback check is
  noise. `// 169.254.0.0/16 holds the cloud metadata endpoint, which serves
  credentials to anything that asks` is the reason the line exists.
- A comment explains a decision, a trade-off, or a thing that bit us. If the
  code already says it, do not say it again.
- No comment banners, no section dividers made of `=====`, no TODOs.

Do not imitate this instruction file's style. Imitate `destination.ts`.

## 7. Do not do these

- Do not touch `src/retrieval/`, `src/tools/`, `src/permissions/`, or
  `src/sandbox/`.
- Do not add a way to *allow* loopback. This task makes the distinction
  expressible. Acting on it is a different item with a different review.
- Do not write the local HTTP client.
- Do not edit any file in `docs/`. Put your findings in your report instead.
- Do not edit `tasks/003-phase-11-work-plan.md`.

## 8. Commit

Work on a branch:

```
git checkout -b task/003-5-destination-guard
```

One commit. Message in the style of `git log` on this repo -- imperative mood,
a short subject line, and a body that says why rather than what. Do not add
`Co-Authored-By` lines.

Leave `MCP/studio-web-mcp/src/validation/url.ts` alone. It has changes that are
not yours and not mine, and they stay unstaged.

## 9. Report back

Write, as your final message:

1. Files changed, and what each change was.
2. The passing test count before and after.
3. For each new rule: which line you broke to prove the test worked, and that it
   failed as expected.
4. Anything you found that looks wrong but was out of scope. Do not fix it. Name
   it.
5. Anything in these instructions that turned out to be wrong or impossible.
   Say so plainly rather than working around it silently.
