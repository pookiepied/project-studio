# ADR 0021 — A Grant Belongs To The Project It Was Approved In

**Status:** accepted
**Date:** 2026-08-09
**Supersedes nothing. Narrows ADR 0015.**

## The problem

`permission_grant.project_id` was written on every row from the first migration
that created the table, and never read. The `find` query matched on
`capability_key`, `agent_id`, `revoked_at`, and `conversation_id`.

A column that is written and never read is not a harmless spare. It is a
promise the schema makes and the code does not keep. Anyone reading the table
would conclude grants were project-scoped, because that is what the column says.

The visible consequence: **"always allow `git:push`" approved in one repository
applied in every other one.**

Path grants hid this. Their stored pattern is an absolute path under the
project root, so a grant from project A could not match a resource in project B
anyway — not because the rule was right, but because the data happened to carry
the boundary inside it. Command grants (`git:push`, `git:commit`) have no path
in them and no such accident to protect them.

## The decision

**A grant applies only in the project where it was approved.**

Three parts:

1. `find` matches `project_id` against `scope.projectId`.
2. A row with no project applies anywhere, mirroring how a row with no
   conversation applies to any conversation. Nothing in the application writes
   one, because `scope.projectId` is always set. This covers fixtures rather
   than opening a route around the rule.
3. A grant tied to this project outranks one tied to no project, for the same
   reason a conversation grant outranks a standing one: prefer the narrower
   match, or we report a permission the user never gave.

## Why this and not the alternative

The alternative was to stop writing the column and accept that approvals are
machine-wide. It is simpler, and simpler is usually right here.

It was rejected because it contradicts the shape of everything else in the
permission system:

- The scope ladder in ADR 0015 never offers a rung above the workspace root.
  A grant that then applies above the workspace root undoes that at storage
  time.
- Trust is per folder (ADR 0018). An approval that outlives the folder it was
  given in would let a user trust one repository and silently authorize an
  action in a repository they never opened.

"Never offer authority wider than what the user is looking at" is already the
rule. This makes storage obey it.

## The migration this forced

The unique index did not include `project_id`:

```
(capability_key, agent_id, IFNULL(conversation_id, ''), IFNULL(resource_pattern, ''))
```

With the query narrowed and the index unchanged, approving the same thing in a
second project collides with the first row. The insert fails, the catch looks
for an existing grant, `find` correctly reports none — and the approval the user
just gave is thrown as a storage error.

Migration 5 rebuilds the index with `IFNULL(project_id, '')` in it.

**The rule this is an instance of:** when a query narrows, its uniqueness rule
narrows with it. They describe the same relation from two directions, and
changing one without the other makes the row that should exist unrepresentable.

No data changes. Existing rows already carry the project they were approved in,
so they narrow to it rather than being lost.

## What this costs

The user is asked again the first time they do something in a new project. That
is the intended behaviour, not a side effect — it is the difference between
"you allowed this here" and "you allowed this everywhere".

## Still open

Whether the settings UI should group grants by project and allow revoking a
whole project's approvals at once. If it does, `project_id` wants an index of
its own. Not decided, and not needed until Phase 18.
