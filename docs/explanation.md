# Explanation

Why `@seneca/owner` works the way it does. This is background reading —
nothing here is needed to get started ([tutorial](tutorial.md)) or to
look something up ([reference](reference.md)).


## The problem: authorisation leaks out of the model

Multi-user systems repeat one query forever: *is this row this caller's
to see?* Written by hand it becomes `where owner_id = ?` sprinkled
through every service method, and the failure mode is silent — one
forgotten clause exposes another tenant's data, and nothing in the tests
notices, because the happy path still works.

The clause is not really business logic. It is a property of the data
model: *this entity kind is owned along these axes*. `@seneca/owner`
takes that property out of the call sites and states it once, in the
plugin options.


## Enforcement at the message layer

Seneca is a message system: `seneca-entity` turns `load$`, `save$`,
`list$` and `remove$` into `sys:entity` messages. The plugin wraps those
messages (`annotate`) instead of subclassing entities or patching a
store.

That choice buys three things:

- **Nothing can bypass it.** Any code path that reaches the store does so
  by sending a message, including code you did not write. There is no
  "raw" accessor that skips the check.
- **Store independence.** Rules are expressed as query refinement and
  field comparison, so the same configuration works over memory,
  MongoDB, Postgres or a remote store.
- **Composability.** Wrapping is ordinary Seneca layering, so ownership
  coexists with validation, auditing or caching plugins on the same
  patterns.

The cost is that guarded patterns must already exist when the plugin
loads — you can only wrap what is registered — and that enforcement lives
one level below your domain messages, where the only vocabulary is
entities, commands and queries.


## Identity travels as message context, not as an argument

The caller's identity is read from `meta.custom` (`sysowner` by default),
which Seneca propagates down the whole message call tree. A gateway
creates one delegate per request:

```js
const user = seneca.delegate(null, { custom: { sysowner: { owner_id, org_id, role } } })
```

Every entity operation performed while handling that request — however
many services deep — carries the same owner record without any function
having to pass it along. Identity is ambient, like a transaction context,
which is exactly what it is.

This is also why a Seneca instance *without* the owner property is
unrestricted: no identity, no restriction. That is deliberate — internal
system code, seed scripts and administrative jobs run on the root
instance — but it means a missing owner record fails **open**. Anything
externally reachable must go through a gateway that sets identity, and
`include.custom` exists to add further activation conditions when you
want a second lock.


## Axes: ownership is ordered, not flat

`fields` declares ownership *axes*, most specific first:

```js
fields: ['owner_id', 'org_id']
```

The ordering is the whole design. `fields[0]` is the user axis;
`fields[1]` is the tenant axis; anything further is broader still. Each
axis is enforced independently — a row must match on every enforced axis
— but roles relax them **as a prefix**: a role can stop enforcing the
axes more specific than its `scope`, never the broader ones.

This is what makes "an admin sees the whole organisation but never
another organisation" the *default* shape rather than a rule you have to
remember to write. Relaxing the user axis is a normal seniority
statement; leaving a tenant is not something a role can express at all,
short of the explicit `scope: '*'`.

Nothing is hardcoded to `owner_id`/`org_id` — the axes are whatever you
declare, and `tenant_id` or `account` behave identically. The presets and
the `scope` machinery talk about *positions*, not names.


## Roles compile to a decision table

Roles form an inherit DAG. Rather than walking that graph per message,
the plugin compiles it once at registration into, per role, a Patrun of
entity pattern → `{ops, spec}`. A message then costs one Patrun lookup
and a set membership test, independent of how deep the hierarchy is or
how many rows the table holds.

Two consequences fall out of the compilation:

- **Errors are startup errors.** An unknown parent, a cycle or a scope
  naming a field you never declared throws while the plugin is defining,
  not on the unlucky request that first reaches it.
- **Broader grants are folded into narrower ones.** Patrun returns only
  the most specific match, so a role with `{entity:'*', ops:['load$']}`
  and `{entity:'sys/doc', ops:['save$']}` would otherwise lose `load$` on
  `sys/doc`. Compilation unions each strictly-broader grant into the
  grants it covers, narrowest first, so specific grants add to the
  general baseline instead of shadowing it — while a role's own spec
  still wins over an inherited one.

Inheritance is explicit. A role named `admin` inherits nothing unless it
says `inherits: ['editor']`, and declaring any roles replaces the presets
entirely. Configuration that reads as complete should *be* complete;
guessing that `admin` outranks `member` because of what the words mean in
English is how authorisation systems acquire holes.


## Quiet reads, loud writes

A denial resolves differently depending on the command: `list` yields
`[]`, `load` yields `null`, `remove` does nothing, and `save` rejects
with `role-entity-not-allowed`.

The asymmetry is intentional. A read that is not permitted is
indistinguishable from a read that found nothing, which is both what the
caller's code already handles and what avoids confirming that a row
exists. A write that is not permitted is a bug in the caller — it
believed it could change something it cannot — and silently discarding it
would produce a system that appears to work and quietly loses data.

The same asymmetry applies to plain ownership: a foreign row simply does
not match the refined query, while writing outside your ownership raises
`create-not-allowed` or `update-not-allowed`.


## Reads: refine the query, except by id

For `list`, `remove` and `load` by query, the plugin adds the owner's
values to the query before the store sees it. The store returns only
permitted rows, so there is no filtering pass and no window in which
extra rows exist in memory.

`load` by id is handled the other way round: the query is left untouched
and the returned row is checked field by field. Rewriting an id lookup
into a compound query would defeat the store's id-based caching for the
overwhelmingly common case, and the row is a single object, so
post-checking costs nothing. The visible consequence is the
[public-field](reference.md#public-fields) asymmetry — a public flag
relaxes query refinement, but a `load$(id)` of someone else's row still
returns `null`.


## Writes are checked against the stored row

Creating a row stamps the owner's axis values (`inject`) and rejects any
value the caller supplied that is not their own (`write`). Updating is
stricter: the plugin re-loads the existing row *through the same
ownership rules* before allowing the write. A caller who cannot read the
row cannot update it — the update fails with `save-not-found` rather than
leaking the row's existence — and a caller who can read it still may not
move it to another owner unless the field is marked `alter`.

The re-load is an extra round trip per update. It is the price of not
trusting the entity the caller handed you, which is the only entity the
store would otherwise see.


## Escape hatches, in increasing order of power

Real systems always have exceptions. Rather than one general mechanism,
there is a ladder, and the guidance is to stay as low on it as possible:

1. **`ignore`** — some messages are not about user data at all.
2. **Grant `spec`** — one entity behaves differently for one role (a
   shared catalogue, say).
3. **`public.read`** — rows opt into being readable by flag.
4. **`specprop`** — one message pattern carries its own rules.
5. **Case modifiers** (`sys:owner,hook:case`) — rules computed at
   runtime from the owner record, when the answer depends on data the
   configuration cannot know.

The lower rungs are declarative and inspectable; the top rung is
arbitrary code that runs on every guarded message. It exists because
group membership, support impersonation and feature flags are real, not
because rules should generally be code.


## What this plugin is not

- **Not authentication.** It never establishes who the caller is; it
  consumes an owner record someone else put on `meta.custom`.
- **Not field-level redaction.** Access is decided per row, not per
  column; a permitted row is returned whole.
- **Not a policy engine.** There are no conditions on row content, times
  or relationships beyond the ownership axes — that is what case
  modifiers are for.
- **Not a substitute for store-level security.** Anything with direct
  database credentials bypasses it entirely.


## Further reading

- [Tutorial](tutorial.md) — build it up step by step.
- [How-to guide](how-to.md) — task-shaped recipes.
- [Reference](reference.md) — every option, message and error.
- [`AGENTS.md`](../AGENTS.md) — working on this repository itself.
