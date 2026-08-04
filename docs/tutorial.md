# Tutorial: ownership, tenants and roles

In this tutorial you build up a small Seneca service where users can only
see their own data, organisations cannot see each other, and an admin can
work across a whole organisation. Each step is a complete runnable
program — copy it into a file and run it with `node`.

You need Node.js 24+ and a directory with the packages installed:

```sh
npm install seneca seneca-entity seneca-promisify @seneca/owner
```

By the end you will have used the three layers the plugin provides:
ownership fields, a tenant axis, and roles. The
[explanation](explanation.md) covers *why* each layer looks the way it
does; here we just make it work.


## 1. Guard the entity messages

Ownership is applied to Seneca messages, so the plugin needs to know two
things: which messages carry user data (`annotate`) and which entity
fields identify the owner (`fields`).

```js
const Seneca = require('seneca')

Seneca({ legacy: false })
  .test()
  .use('promisify')
  .use('entity')
  .use('owner', {
    fields: ['owner_id'],
    annotate: ['sys:entity'],
  })
  .ready(async function () {
    console.log('ready')
  })
```

`annotate: ['sys:entity']` guards every entity operation —
`seneca-entity` registers `cmd:save,sys:entity`, `cmd:load,sys:entity`
and so on, and the plugin wraps them all. `fields: ['owner_id']` says
rows are owned through their `owner_id` column.

Nothing is enforced yet: the plugin only acts when a caller has an
identity.


## 2. Give callers an identity

An identity is an *owner record* on `meta.custom.sysowner`. In a real
service a gateway or auth plugin puts it there per request; here we make
two delegates by hand.

```js
  .ready(async function () {
    const alice = this.delegate(null, {
      custom: { sysowner: { owner_id: 'alice' } },
    })
    const bob = this.delegate(null, {
      custom: { sysowner: { owner_id: 'bob' } },
    })

    const note = await alice.entity('sys/note').save$({ title: 'hello' })
    console.log(note.owner_id)                              // alice

    console.log(await alice.entity('sys/note').load$(note.id))  // the note
    console.log(await bob.entity('sys/note').load$(note.id))    // null
    console.log(await bob.entity('sys/note').list$())           // []
  })
```

Three things happened without any code of yours:

- **Injection.** `owner_id` was stamped onto the new row from the owner
  record — you never set it.
- **Read checks.** Bob's `load$` of Alice's row returned `null`, not an
  error. Denied reads look like missing data.
- **Query refinement.** Bob's `list$` was rewritten to
  `{owner_id: 'bob'}` before the store saw it, so Alice's row was never a
  candidate.

Writes are noisier, because a rejected write is a caller bug:

```js
    try {
      await bob.entity('sys/note').save$({ title: 'nope', owner_id: 'alice' })
    } catch (err) {
      console.log(err.code)      // create-not-allowed
    }
```

Note that the root instance (`this`, with no `sysowner`) still sees
everything. No identity means no restriction — that is how internal jobs
and seed scripts work.


## 3. Add a tenant axis

Most systems own data along more than one axis: a row belongs to a user
*and* to an organisation. Add a second field:

```js
  .use('owner', {
    fields: ['owner_id', 'org_id'],
    annotate: ['sys:entity'],
  })
```

Order matters. The first field is the **user axis**, the second is the
**tenant axis**, and anything later is broader still. Give the delegates
both values:

```js
    const alice = this.delegate(null, {
      custom: { sysowner: { owner_id: 'alice', org_id: 'wonderland' } },
    })
    const carol = this.delegate(null, {
      custom: { sysowner: { owner_id: 'carol', org_id: 'looking-glass' } },
    })

    const note = await alice.entity('sys/note').save$({ title: 'hello' })
    console.log(note.owner_id, note.org_id)     // alice wonderland

    console.log(await carol.entity('sys/note').load$(note.id))   // null
```

Both axes are now stamped on save and enforced on read. The names are
yours: `tenant_id`, `account`, `team` all behave identically — only the
position in `fields` is meaningful.


## 4. Turn on roles

So far everyone is equal: each caller sees exactly their own rows. Roles
add seniority. Switch the role system on:

```js
  .use('owner', {
    fields: ['owner_id', 'org_id'],
    annotate: ['sys:entity'],
    rolesys: true,
  })
```

With no roles declared you get two presets — `member` (own rows, any
entity) and `admin` (the whole tenant, any entity). A caller's role comes
from the `role` property of the owner record, defaulting to `member`:

```js
    const alice = this.delegate(null, {
      custom: { sysowner: { owner_id: 'alice', org_id: 'wonderland' } },
    })
    const admin = this.delegate(null, {
      custom: { sysowner: { owner_id: 'root', org_id: 'wonderland', role: 'admin' } },
    })
    const otherAdmin = this.delegate(null, {
      custom: { sysowner: { owner_id: 'root', org_id: 'looking-glass', role: 'admin' } },
    })

    const note = await alice.entity('sys/note').save$({ title: 'hello' })

    console.log(await admin.entity('sys/note').load$(note.id))       // the note
    console.log(await otherAdmin.entity('sys/note').load$(note.id))  // null
```

The admin's `scope` is the tenant axis, which relaxes every axis *more
specific* than it — here, the user axis. The tenant axis itself stays
enforced, so an admin of another organisation is still blocked. A role
can be senior within its tenant; it cannot leave it.


## 5. Declare your own roles

Presets are a starting point. Real applications name their own roles,
say which entities each may touch, and chain them:

```js
  .use('owner', {
    fields: ['owner_id', 'org_id'],
    annotate: ['sys:entity'],
    rolesys: true,
    roles: {
      member: { grants: [{ entity: 'sys/note', ops: ['list$','load$','save$'] }] },
      editor: { inherits: ['member'], grants: [{ entity: 'sys/doc' }] },
      admin:  { scope: 'org_id', inherits: ['editor'], grants: [{ entity: 'sys/audit' }] },
    },
  })
```

Read that as three statements:

- a `member` may list, load and save its own `sys/note` rows — and
  nothing else, note the missing `remove$`;
- an `editor` may do everything a member may, plus full access to its own
  `sys/doc` rows;
- an `admin` may do everything an editor may, plus `sys/audit`, and works
  across all users in its organisation.

Declaring `roles` **replaces** the presets — there is no hidden `member`
or `admin` any more, and a role you never declared has no permissions at
all.

```js
    const member = this.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', org_id: 'A', role: 'member' } },
    })
    const editor = this.delegate(null, {
      custom: { sysowner: { owner_id: 'e0', org_id: 'A', role: 'editor' } },
    })
    const admin = this.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', org_id: 'A', role: 'admin' } },
    })

    const note = await member.entity('sys/note').save$({ title: 'n' })
    console.log(note.owner_id, note.org_id)                 // u0 A

    // Not granted sys/doc at all:
    console.log(await member.entity('sys/doc').list$())      // []
    console.log(await member.entity('sys/doc').load$('x'))   // null
    try {
      await member.entity('sys/doc').save$({ t: 1 })
    } catch (err) {
      console.log(err.code)                                  // role-entity-not-allowed
    }

    // Granted through inheritance:
    const doc = await editor.entity('sys/doc').save$({ t: 2 })
    await editor.entity('sys/note').save$({ title: 'e' })

    // Senior role, same org:
    console.log(await admin.entity('sys/doc').load$(doc.id))  // the doc

    // ops: no remove$ for member, so this is a silent no-op
    await member.entity('sys/note').remove$(note.id)
    console.log(await member.entity('sys/note').load$(note.id))  // still there
```

Denials are quiet on reads (`[]`, `null`), quiet on `remove`, and loud on
`save`. That is the rule throughout: an unreadable row looks like a
missing row, an impossible write throws.


## 6. Find out why

When a decision surprises you, capture it with Seneca's `explain$` on the
enclosing message:

```js
    this.message('get:doc', async function (msg) {
      return await this.entity('sys/doc').load$(msg.id)
    })

    const explain = []
    await member.post({ get: 'doc', id: 'x', explain$: explain })

    console.log(explain.find((e) => e && e.role_denied).role_denied)
    // { role: 'member', entity: 'sys/doc', cmd: 'load' }
```

Each guarded action appends a record describing the decision: the owner
record, the spec applied, the refined query, the field that failed to
match, or — as here — the role denial. The full field list is in the
[reference](reference.md#explain-data).


## Where to go next

- [How-to guide](how-to.md) — gateway wiring, read-only roles, public
  rows, custom tenant keys, and the other tasks that come up next.
- [Reference](reference.md) — every option, grant key, error code and
  explain field.
- [Explanation](explanation.md) — the reasoning behind axes, scopes,
  compiled roles and the quiet-read/loud-write asymmetry.
