# How-to guide

Task-shaped recipes. Each one is self-contained; see the
[reference](reference.md) for the full option and message details, and
the [tutorial](tutorial.md) if you have not set the plugin up before.

**Wiring**
- [Guard only some entity commands](#guard-only-some-entity-commands)
- [Exclude particular entities or messages](#exclude-particular-entities-or-messages)
- [Read identity from a gateway principal](#read-identity-from-a-gateway-principal)
- [Use your own tenant key](#use-your-own-tenant-key)
- [Require more than an owner record before enforcing](#require-more-than-an-owner-record-before-enforcing)

**Roles**
- [Adopt roles in an existing deployment](#adopt-roles-in-an-existing-deployment)
- [Give a role read-only access](#give-a-role-read-only-access)
- [Share one entity across a role](#share-one-entity-across-a-role)
- [Add a cross-tenant superadmin](#add-a-cross-tenant-superadmin)
- [Deny callers whose role you do not recognise](#deny-callers-whose-role-you-do-not-recognise)

**Data rules**
- [Publish rows that anyone may read](#publish-rows-that-anyone-may-read)
- [Let a caller belong to several tenants](#let-a-caller-belong-to-several-tenants)
- [Allow ownership to be transferred](#allow-ownership-to-be-transferred)
- [Override the rules for one message](#override-the-rules-for-one-message)
- [Compute rules at runtime](#compute-rules-at-runtime)

**Operating**
- [Debug why a decision was made](#debug-why-a-decision-was-made)
- [Keep test output readable](#keep-test-output-readable)


## Guard only some entity commands

`annotate` patterns are `seneca.wrap`ped, so each must match actions that
already exist. `seneca-entity` registers `cmd:save,sys:entity`,
`cmd:load,sys:entity`, `cmd:list,sys:entity` and
`cmd:remove,sys:entity`. Guard all of them with the common prefix:

```js
annotate: ['sys:entity']
```

…or name the commands you want:

```js
annotate: ['sys:entity,cmd:save', 'sys:entity,cmd:load']
```

Anything you leave out is **unguarded** — in the example above `list$`
returns every row to every caller.

A pattern that matches no registered action (for example
`'sys:entity,base:zed'`, which is narrower than anything `seneca-entity`
adds) does not filter the guarded set: it registers a new, priorless
action that swallows the operation and returns `null`. If entity
operations start returning `null` for everyone, check this first.


## Exclude particular entities or messages

Use `ignore` to punch holes in an `annotate` pattern. Matching is by
Patrun, against the same message:

```js
.use('owner', {
  fields: ['owner_id'],
  annotate: ['sys:entity'],
  ignore: ['sys:entity,name:audit', 'sys:entity,base:config'],
})
```

Ignored messages pass straight through with no injection and no checks —
useful for reference data, counters and system tables that no one owns.


## Read identity from a gateway principal

Gateways rarely produce an object shaped like the plugin's default. Point
`ownerprop` at a dot path, and map owner-side field names to entity-side
column names with `owner:entity` entries:

```js
.use('owner', {
  ownerprop: 'principal.user',    // meta.custom.principal.user
  fields: ['id:owner_id'],        // principal.user.id  ->  ent.owner_id
  annotate: ['sys:entity'],
})
```

```js
const user = seneca.delegate(null, {
  custom: { principal: { user: { id: 'u0' } } },
})

await user.entity('sys/note').save$({ x: 1 })   // stamped owner_id: 'u0'
```

Remember that spec keys then use the **raw** entry (`spec.read['id:owner_id']`)
while role `scope` uses the entity-side name (`scope: 'owner_id'`).


## Use your own tenant key

Nothing is hardcoded to `org_id`. The tenant axis is simply the second
entry in `fields`:

```js
.use('owner', {
  fields: ['owner_id', 'tenant_id'],
  annotate: ['sys:entity'],
  rolesys: true,
  roles: {
    member: { grants: [{ entity: 'sys/note' }] },
    admin: { scope: 'tenant_id', grants: [{ entity: 'sys/note' }] },
  },
})
```

Rows are stamped with `tenant_id`, the preset `admin` (if you declare no
roles) scopes to `tenant_id`, and cross-tenant reads are blocked exactly
as they would be with `org_id`.


## Require more than an owner record before enforcing

By default the plugin activates whenever the owner record exists.
`include.custom` adds further conditions on `meta.custom` — equality, or
`{owner$: 'exists'}` for "present":

```js
.use('owner', {
  fields: ['owner_id'],
  annotate: ['sys:entity'],
  include: { custom: { mode: 'secure' } },
})
```

Now only callers whose `meta.custom.mode === 'secure'` are subject to
ownership. Note the direction: a failed condition leaves the message
**unguarded**, it does not deny it. Use this to scope enforcement to a
subsystem, not as a second authorisation gate.


## Adopt roles in an existing deployment

Ownership and roles are separate layers — `rolesys: false` (the default)
means field ownership only. To adopt roles without rewriting your
configuration:

1. Turn on `rolesys: true` with **no** `roles`. The presets apply:
   `member` (own rows, every entity) and `admin` (the whole tenant, every
   entity). Existing callers with no `role` property become `member`,
   which behaves exactly as plain ownership did.
2. Start issuing `role: 'admin'` in owner records where you want
   tenant-wide access.
3. When you are ready to restrict entities, declare `roles` explicitly —
   remembering that declaring any roles **replaces** the presets, so
   every role you use (including `member` and `admin`) must now be
   listed.

Role compilation errors — an unknown parent, a cycle, a `scope` naming a
field that is not in `fields` — are thrown at plugin definition, so a bad
role set fails at startup rather than at request time.


## Give a role read-only access

`ops` lists the operations a grant allows. Omit `save$` and `remove$`:

```js
roles: {
  viewer: { grants: [{ entity: 'sys/doc', ops: ['list$', 'load$'] }] },
  editor: { inherits: ['viewer'], grants: [{ entity: 'sys/doc' }] },
}
```

`editor` inherits the viewer grant and adds the full-op grant on the same
entity; the two are unioned, so an editor gets all four operations.

A viewer's `save$` rejects with `role-entity-not-allowed`; its `remove$`
is a silent no-op.


## Share one entity across a role

Grants may carry a `spec` fragment that applies only when that grant
matches — the clean way to make one entity behave differently:

```js
roles: {
  member: {
    grants: [
      { entity: 'sys/note' },                                     // own rows
      { entity: 'sys/catalogue', spec: { read: { owner_id: false } } },
    ],
  },
}
```

Members read every `sys/catalogue` row regardless of owner, while
`sys/note` stays private. Ownership fields are re-unioned after the merge,
so a grant spec can relax an axis but cannot accidentally drop one.


## Add a cross-tenant superadmin

`scope` names the broadest axis a role operates on; `'*'` relaxes every
axis:

```js
roles: {
  member: { grants: [{ entity: '*' }] },
  superadmin: { scope: '*', grants: [{ entity: '*' }] },
}
```

```js
const su = seneca.delegate(null, {
  custom: { sysowner: { owner_id: 's0', org_id: 'A', role: 'superadmin' } },
})

await su.entity('sys/row').list$()   // rows from every org
```

This is the only way a role leaves its tenant. Any other `scope` value
relaxes the axes *more specific* than it and keeps the rest enforced.


## Deny callers whose role you do not recognise

A role name you never declared has no permissions — that is already the
default, and it applies even when a role of that name would have been a
preset:

```js
const hacker = seneca.delegate(null, {
  custom: { sysowner: { owner_id: 'u1', role: 'hacker' } },
})

await hacker.entity('sys/foo').list$()          // []
await hacker.entity('sys/foo').save$({ x: 1 })  // role-entity-not-allowed
```

The gap is an owner record with **no** `role` property at all: it falls
back to `defaultRole`, which is `'member'`. If callers should have to
carry an explicit role, close that fallback:

```js
.use('owner', {
  fields: ['owner_id'],
  annotate: ['sys:entity'],
  rolesys: true,
  defaultRole: null,           // no role property => no permissions
  roles: { member: { grants: [{ entity: 'sys/foo' }] } },
})
```

Set `defaultRole` to another declared role name if you want a different
baseline instead.


## Publish rows that anyone may read

`public.read` maps an axis (or `'*'`) to a query flag field. When a query
sets that flag, ownership refinement is skipped for that axis:

```js
.use('owner', {
  fields: ['owner_id'],
  annotate: ['sys:entity'],
  default_spec: { public: { read: { '*': 'is_public' } } },
})
```

```js
await u0.entity('sys/post').save$({ x: 1, is_public: true })

await u1.entity('sys/post').list$({ is_public: true })  // [ the row ]
await u1.entity('sys/post').list$()                     // [] — own rows only
```

Public flags work on queries only. `load$(id)` of another owner's public
row still returns `null`; fetch it by query
(`load$({is_public: true, …})`) instead.


## Let a caller belong to several tenants

An axis value may be an array — the caller then matches any of those
values:

```js
const multi = seneca.delegate(null, {
  custom: { sysowner: { owner_id: 'm0', org_id: ['A', 'B'], role: 'admin' } },
})

await multi.entity('sys/row').list$()               // rows from A and B
await multi.entity('sys/row').save$({ x: 1 })       // stamped org_id: 'A' (first)
await multi.entity('sys/row').list$({ org_id: 'C' }) // throws field-not-valid
```

Array axes become `$in`-style queries, so the store must support them.
Saves stamp the **first** element, and an explicit query value outside
the array fails with `field-not-valid` (or `field-values-not-valid` for
an array query) rather than being silently narrowed.


## Allow ownership to be transferred

Ownership fields are write-protected: an update that changes one raises
`update-not-allowed`. Mark the field `alter` in a spec to permit it. Keep
that spec narrow — one message pattern, not the global default:

```js
const make_spec = seneca.export('Owner/make_spec')
const transferable = make_spec({ alter: { owner_id: true } })

seneca.add('transfer:note', { custom$: { 'sys-owner-spec': transferable } },
  function (msg, reply) {
    this.entity('sys/note').load$(msg.id, function (err, note) {
      if (err || null == note) return reply(err)
      note.owner_id = msg.to
      note.save$(reply)
    })
  })
```

The caller still has to be able to read the row — the update path
re-loads it under the same ownership rules — so this transfers *away*
from yourself, not *from* someone else.


## Override the rules for one message

The `sys-owner-spec` custom property replaces the default spec for the
messages that carry it. Attach it to a message pattern (as above) or to a
delegate:

```js
const admin = seneca.delegate(null, {
  custom: {
    sysowner: { owner_id: 'a0' },
    'sys-owner-spec': make_spec({ read: { owner_id: false } }),
  },
})
```

Always build the value with the `Owner/make_spec` export: a raw object
replaces the default spec wholesale, while `make_spec` expands your
fragment against `default_spec` and fills in the field defaults.


## Compute rules at runtime

When the rule depends on data the configuration cannot know — group
membership, an impersonation flag, a support session — register a
**case** and select it per caller with `case$`:

```js
seneca.act('sys:owner,hook:case,case:support', {
  modifiers: {
    // rewrite the spec for this caller
    query: function (spec, owner, msg) {
      spec.read.owner_id = false      // read across users…
      spec.write.owner_id = false     // …but org_id is untouched, so the
      return spec                     //    tenant boundary still holds
    },
    // post-filter what the store returned
    list: function (spec, owner, msg, list) {
      return list.filter((row) => !row.secret)
    },
  },
})
```

```js
const support = seneca.delegate(null, {
  custom: { sysowner: { owner_id: 's0', org_id: 'A', case$: 'support' } },
})
```

There is also an `entity` modifier, called on `load` by id before the
field checks, which can adjust the spec using the loaded row. Modifiers
run on every guarded message, so keep them cheap, and prefer a grant
`spec` when the rule is static.


## Debug why a decision was made

Capture the enclosing message with `explain$`:

```js
const explain = []
await user.post({ get: 'doc', id: 'x', explain$: explain })

console.log(explain.find((e) => e && e.role_denied).role_denied)
// { role: 'member', entity: 'sys/doc', cmd: 'load' }
```

Each guarded action appends one record: the owner record and spec
applied, the refined query, `field_match_fail` for a read that did not
match, `fail` for a rejected write, `role_denied` for a role denial, or
`ignored`/`active: false` when the message was not guarded at all. The
full list is in the [reference](reference.md#explain-data).

`explain$` must be set on a **message** — attaching it to a direct
`entity(...).load$()` call does not currently collect the plugin's
records. Wrap the operation in an action and `post` it, as above.

For a broader capture across a whole session — including in the browser,
via [seneca-browser](https://github.com/voxgig/seneca-browser) — use:

```js
const explain_log = seneca.explain(true)
// ... user interface actions that generate requests
console.log(explain_log)
```


## Keep test output readable

Seneca's `.test()` logs every action error with a stack trace. Tests that
assert on denials therefore produce a lot of expected-error noise. Pass a
log level to silence it while keeping test mode:

```js
// test/helper.js
const LOG = process.env.SENECA_TEST_LOG || 'silent'
```

```js
const s0 = await Seneca({ legacy: false })
  .test(LOG)
  .use('promisify')
  .use('entity')
  .use(Plugin, { /* ... */ })
  .ready()
```

Run `SENECA_TEST_LOG=test npm test` to get the errors back when
diagnosing a failure. Assert on denials by code, not by log output:

```js
await rejects(member.entity('sys/doc').save$({ x: 1 }),
  { code: 'role-entity-not-allowed' })
```
