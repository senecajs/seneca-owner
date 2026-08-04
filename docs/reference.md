# Reference

Complete description of every option, data structure, message, error and
debug field in `@seneca/owner`. For a guided introduction start with the
[tutorial](tutorial.md); for task recipes see the
[how-to guide](how-to.md); for the design rationale see
[explanation](explanation.md).

- [Plugin registration](#plugin-registration)
- [Options](#options)
- [The owner record](#the-owner-record)
- [Field syntax](#field-syntax)
- [The spec](#the-spec)
- [Roles](#roles)
- [Grants](#grants)
- [Message handling](#message-handling)
- [Denial matrix](#denial-matrix)
- [Action patterns](#action-patterns)
- [Case modifiers](#case-modifiers)
- [Plugin exports](#plugin-exports)
- [Error codes](#error-codes)
- [Explain data](#explain-data)
- [Compatibility](#compatibility)


## Plugin registration

```js
const Seneca = require('seneca')

Seneca({ legacy: false })
  .use('promisify')
  .use('entity')
  .use('owner', { /* options */ })   // or .use(require('@seneca/owner'), {...})
```

`seneca.use` resolves the bare name `owner` through the `@seneca/`
prefix, so `.use('owner', …)` and `.use('@seneca/owner', …)` are
equivalent. The plugin must be registered **after** `entity`, because it
wraps the entity actions that already exist.

Options are validated by [`shape`](https://www.npmjs.com/package/shape)
at registration time. An unknown-scope, unknown-parent or cyclic role
definition throws while the plugin is defining (see
[error codes](#error-codes)).


## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `fields` | `string[]` | `[]` | The ownership axes, most specific first. Entry syntax is `entity_field` or `owner_field:entity_field` — see [field syntax](#field-syntax). |
| `annotate` | `string[]` | `[]` | Message patterns to guard (Jsonic strings). Each pattern is `seneca.wrap`ped, so it must match already-registered actions — with `seneca-entity` that is `sys:entity` (or `sys:entity,cmd:save` etc). |
| `ignore` | `string[]` | `[]` | Patterns matched (via Patrun) against each guarded message; a match passes the message straight through unguarded. |
| `rolesys` | `boolean` | `false` | Master switch for role enforcement. When `false` only field ownership applies and `roles` is ignored. |
| `roles` | `object` | *(presets)* | Role definitions, see [roles](#roles). When `rolesys` is on and `roles` is absent or empty, the built-in presets apply. |
| `defaultRole` | `string \| null` | `'member'` | Role used when the owner record has no `role` property. `null` denies instead. An owner record naming an *unknown* role is always denied — `defaultRole` only covers an absent role. |
| `roleprop` | `string` | `'role'` | Property of the owner record holding the role name. |
| `ownerprop` | `string` | `'sysowner'` | `meta.custom` key holding the owner record. Dot paths are supported (`'principal.user'`). |
| `specprop` | `string` | `'sys-owner-spec'` | `meta.custom` key holding a per-message [spec](#the-spec) override. |
| `caseprop` | `string` | `'case$'` | Property of the owner record naming a registered [case](#case-modifiers). |
| `default_spec` | `object` | see [spec](#the-spec) | Base spec used when no per-message spec is supplied. `fields` is unioned into `default_spec.fields`. |
| `owner_required` | `boolean` | `true` | When `false`, a message with no owner record skips ownership handling entirely. See the note below. |
| `include.custom` | `object` | `{[ownerprop]: {owner$:'exists'}}` | Extra activation conditions on `meta.custom`. Values are compared for equality; `{owner$:'exists'}` means "any non-null value". Keys may be dot paths. Your object is merged over the default, so the owner record is required unless you override that key. |
| `entprop` | `string` | `'ent'` | Message property holding the entity (matches `seneca-entity`). |
| `queryprop` | `string` | `'q'` | Message property holding the query (matches `seneca-entity`). |
| `ownerfield` | `string` | *(axis name of `fields[0]`)* | Reserved. Currently threaded into role compilation but not used by it; leave unset. |
| `explain` | `any` | *(unset)* | Reserved. Explain capture is controlled by Seneca's `explain$`, not by this option; the value is only echoed in the `config` export and explain records. |

**On `owner_required`.** A missing owner record never *denies* a
message. With the default `include.custom` rule the message is simply
not guarded, whether `owner_required` is `true` or `false` — this is why
a root instance with no `sysowner` custom property has unrestricted
access. The flag matters only when you replace `include.custom` with a
rule that can activate without an owner record.


## The owner record

The owner record is a plain object placed on `meta.custom` under
`ownerprop`, normally by a gateway or auth plugin:

```js
const user = seneca.delegate(null, {
  custom: {
    sysowner: {
      owner_id: 'alice',      // an axis value, keyed by the owner-side field name
      org_id: 'wonderland',   // another axis value
      role: 'editor',         // consumed when rolesys is on (roleprop)
      case$: 'support',       // optional case selector (caseprop)
    },
  },
})
```

`custom` propagates down the message call tree, so every entity operation
performed while handling that message carries the same owner record.

An axis value may be an **array** — the owner then matches any of those
values. Array axes change three behaviours:

- queries become `$in`-style (`q[field] = [a, b]`), which the store must
  support;
- an explicit query value must be a member of the array, otherwise the
  message fails with `field-not-valid` / `field-values-not-valid`;
- on save the **first** element is injected.

A `null`/`undefined` axis value is dropped from the query, i.e. that axis
is not enforced for that caller.


## Field syntax

Each `fields` entry names one ownership axis:

| Entry | Owner-side name | Entity-side name |
|---|---|---|
| `'owner_id'` | `owner_id` | `owner_id` |
| `'id:owner_id'` | `id` | `owner_id` |
| `'usr:user_id'` | `usr` | `user_id` |

The owner-side name is read from the owner record; the entity-side name
is the column stamped on and matched against the entity.

Three different names refer to an axis in different places — keep them
straight:

- **spec keys** (`read`, `write`, `inject`, `alter`) use the **raw
  entry**, e.g. `spec.read['id:owner_id']`;
- **role `scope`** uses the **entity-side** name, e.g. `scope: 'org_id'`;
- **queries and entity data** use the entity-side name.

Axis order is significant. `fields[0]` is the *user axis*, `fields[1]` is
the *tenant axis* (whatever you call it — `org_id`, `tenant_id`, …), and
so on: earlier is more specific. Role `scope` and the built-in presets
are defined in terms of this ordering.


## The spec

The spec is the per-message rule set. It starts as the message's
`specprop` custom property if there is one, otherwise `default_spec` —
a per-message spec **replaces** the default rather than merging with it,
so build partial specs through the [`Owner/make_spec`
export](#plugin-exports). That starting spec is then rewritten by the
`query` [case modifier](#case-modifiers) (if any) and finally merged
with the matched grant's `spec` (when `rolesys` is on), which takes
precedence.

```js
{
  active: true,               // false => this message is not guarded
  fields: ['owner_id','org_id'],
  read:   { owner_id: true, org_id: true },   // enforce on reads
  write:  { owner_id: true, org_id: true },   // enforce on writes
  inject: { owner_id: true, org_id: true },   // stamp on save
  alter:  { owner_id: false, org_id: false }, // may the value change on update?
  public: { read: {} },                        // public-flag fields
}
```

Every field listed in `fields` defaults to `read: true`, `write: true`,
`inject: true`, `alter: false` (unset `alter` is falsy). Keys added to
any of the four maps are unioned back into `fields`.

| Key | Effect when `true` for a field |
|---|---|
| `read` | Reads are constrained to rows whose field matches the owner: queries get the field added (`list`, `remove`, `load` by query), and a `load` by id is compared field by field, returning `null` on mismatch. |
| `write` | On create, an explicitly supplied value must match the owner's, else `create-not-allowed`. On update, the value may not change (unless `alter`), else `update-not-allowed`. |
| `inject` | On save, the owner's value is stamped onto the entity when the entity does not already have one. |
| `alter` | Permits a `write`-enforced field to change during an update. |

### Public fields

`spec.public.read` maps an ownership field (or `'*'`) to the name of a
**query flag field**:

```js
default_spec: { public: { read: { '*': 'is_public' } } }
```

When a query sets that flag to `true`, ownership refinement is skipped —
for `'*'` all axes are skipped, for a single field only that axis. The
flag stays in the query, so the store still returns only rows carrying
it.

Public flags apply to **query refinement only** (`list`, `remove`, and
`load` by query). A `load` by id still performs the field-match check, so
`load$(id)` of another owner's public row returns `null` while
`load$({is_public:true, …})` returns it.


## Roles

Roles are enforced only when `rolesys: true`.

```js
roles: {
  member: { grants: [{ entity: 'sys/note' }] },
  editor: { inherits: ['member'], grants: [{ entity: 'sys/doc' }] },
  admin:  { scope: 'org_id', inherits: ['editor'], grants: [{ entity: 'sys/audit' }] },
}
```

| Key | Type | Meaning |
|---|---|---|
| `grants` | `Grant[]` | The role's own permissions, see [grants](#grants). |
| `inherits` | `string \| string[] \| 'none'` | Parent roles. Absent, `null`, `'none'` and `[]` all mean "inherit nothing". Effective permissions are the transitive union of parents plus own grants; own grants win on conflict. Inheritance is an explicit DAG — nothing is implied by naming. |
| `scope` | `string \| '*'` | The broadest axis this role operates on. Axes *more specific* than `scope` stop being enforced (`read`/`write` set to `false`); `scope` itself and every broader axis stay enforced. `'*'` relaxes all axes (global). Unset enforces every axis. |

Declaring `roles` **replaces** the presets entirely — no `member` or
`admin` is injected behind your back, and an actor whose role is not
declared is denied.

### Preset roles

With `rolesys: true` and no `roles` declared:

```js
{
  member: { grants: [{ entity: '*' }] },
  admin:  { scope: <tenant axis, or '*' if there is none>,
            grants: [{ entity: '*' }] },
}
```

`member` gets every entity, bounded by every axis (own rows only).
`admin` gets every entity with the user axis relaxed but the tenant axis
still enforced — an admin sees its whole tenant and never another one.


## Grants

```js
{ entity: 'sys/note', ops: ['list$','load$'], spec: { read: { owner_id: false } } }
```

A bare string is shorthand for `{ entity: <string> }`.

| Key | Default | Meaning |
|---|---|---|
| `entity` | *(required)* | Entity pattern: `'base/name'` exact, `'base'` or `'base/*'` for a whole base, `'*'` for everything. Matching uses Patrun, so the most specific pattern wins. |
| `ops` | all four | Allowed operations: `'list$'`, `'load$'`, `'save$'`, `'remove$'`. The trailing `$` is stripped before matching `msg.cmd`, so `'load'` also works. |
| `spec` | `{}` | Spec fragment merged over the message spec when this grant matches — the per-entity escape hatch (e.g. relax `read` on one entity). Ownership fields are re-unioned afterwards, so a grant spec cannot accidentally drop an axis. |

Because Patrun returns only the most specific match, broader grants are
folded into narrower ones at compile time: a role holding both
`{entity:'*', ops:['load$']}` and `{entity:'sys/doc', ops:['save$']}`
ends up with `load$`+`save$` on `sys/doc`. Narrower (and own) specs win
over broader (and inherited) ones.


## Message handling

For every guarded message, in order:

1. **Ignore check** — `ignore` pattern match → pass to the prior action,
   unguarded.
2. **Spec** — `meta.custom[specprop]`, else `default_spec` (deep-copied).
3. **Owner** — `meta.custom[ownerprop]` (dot path supported).
4. **No owner and `owner_required:false`** → pass through.
5. **Case modifier** — `modifiers.query(spec, owner, msg)` may rewrite
   the spec.
6. **Role check** (when `rolesys` and an owner record are present) —
   resolve the role (`roleprop`, else `defaultRole`), find the grant for
   the target entity, verify `msg.cmd` is in `ops`. No entity, no role,
   no grant or wrong op → [deny](#denial-matrix). Otherwise merge the
   grant spec.
7. **Include check** — every `include.custom` condition must hold, else
   the message is *not guarded* (passes through).
8. **Dispatch** by `msg.cmd`:
   - `list` — refine the query, call prior, optionally run
     `modifiers.list` over the result.
   - `remove` — refine the query, list matching rows, run
     `modifiers.list`; if nothing remains, reply without removing.
   - `load` — by id: call prior, run `modifiers.entity`, then compare
     every `read` field, replying `null` on mismatch. By query: refine
     the query first and return whatever the store gives back.
   - `save` — inject fields, then either the create checks (`write`
     fields must match the owner) or the update checks (re-load the row
     through the same ownership rules; `write` fields may not change
     unless `alter`).

`load` by id deliberately does **not** rewrite the query, so store-level
id caching keeps working; the check happens after the read instead.


## Denial matrix

A role denial is quiet on reads and loud on writes:

| `msg.cmd` | Result of a role denial |
|---|---|
| `list` | `[]` — the prior action is never called |
| `load` | `null` |
| `remove` | silent no-op, replies `undefined` |
| `save` | rejects with `role-entity-not-allowed` |

Ownership (field-level) denials behave the same way by construction: a
read simply does not match, so `list` returns fewer rows and `load`
returns `null`; a write raises `create-not-allowed`,
`update-not-allowed` or `save-not-found`.


## Action patterns

* [`hook:case,sys:owner`](#-hookcasesysowner-)

### &laquo; `hook:case,sys:owner` &raquo;

Register a named set of [case modifiers](#case-modifiers). Cases are
selected per caller by the `case$` property (`caseprop`) of the owner
record, which makes rules that depend on runtime data — group
membership, support status, feature flags — possible without touching
the static configuration.

| Message property | Type | Description |
|---|---|---|
| `case` | `string` | Case name, matched against the owner record's `case$`. |
| `modifiers` | `object` | `{ query?, list?, entity? }` — see below. |

Registering the same case name again replaces the previous modifiers.
The action replies with no data.

```js
seneca.act('sys:owner,hook:case,case:support', {
  modifiers: {
    query: function (spec, owner, msg) {
      spec.read.owner_id = false     // support staff read across users
      spec.write.owner_id = false
      return spec                    // …but org_id stays enforced
    },
  },
})
```


## Case modifiers

| Modifier | Signature | Called | Purpose |
|---|---|---|---|
| `query` | `(spec, owner, msg) => spec` | before role and ownership handling, for every command | Rewrite the spec for this caller. Must return the spec. |
| `list` | `(spec, owner, msg, list) => list` | after the store returns rows (`list`, and the pre-check of `remove`) | Filter or transform results. Must return the list. |
| `entity` | `(spec, owner, msg, ent) => spec` | on `load` by id, before the field checks | Adjust the spec using the loaded row. Must return the spec. |

Modifiers are called with `this` bound to the acting Seneca instance. In
the `remove` path, `list` decides what counts as removable: if it returns
an empty list, nothing is removed.


## Plugin exports

Read with `seneca.export('Owner/<name>')`.

| Export | Type | Description |
|---|---|---|
| `Owner/make_spec` | `(spec) => spec` | Expand a partial spec against the plugin's `default_spec` — the same normalisation the plugin applies internally. Use it to build values for the `specprop` custom property. |
| `Owner/casemap` | `object` | Live map of case name → registered modifiers. |
| `Owner/config` | `{spec, options}` | The normalised `default_spec` and the validated options. |

`Owner.intern` (on the required module) exposes the internals used by the
unit tests — `make_spec`, `match`, `resolveFieldNames`, `deny`, … It is
not a supported API.


## Error codes

Read `err.code`; the structured payload is `err.details`.

| Code | When | Details |
|---|---|---|
| `create-not-allowed` | Creating a row with an ownership field that does not match the owner. | `why:'field-mismatch-on-create'`, `field`, `ownerFieldName`, `entityFieldName`, `ent_val`, `owner_val` |
| `update-not-allowed` | Updating a row so that a `write`-enforced, non-`alter` field changes. | `why:'field-mismatch-on-update'`, `field`, `ownerFieldName`, `entityFieldName`, `oldent_val`, `ent_val` |
| `save-not-found` | Update whose existing row cannot be read by this caller (missing, or owned by someone else). | `entity`, `id` |
| `role-entity-not-allowed` | `save` denied by the role system (no grant, or grant lacks `save$`). | `role`, `entity` |
| `field-not-valid` | Query supplies a single value outside a multi-value owner axis. | `field`, `entityFieldName`, `ownerFieldName`, `query_val`, `bad_query_val`, `valid_owner_vals` |
| `field-values-not-valid` | Query supplies an array containing a value outside a multi-value owner axis. | as above |
| `role-scope-unknown` | Plugin definition: a role's `scope` names no declared field. | `scope` |
| `role-inherit-unknown` | Plugin definition: `inherits` names an undeclared role. | `role` |
| `role-inherit-cycle` | Plugin definition: the inherit graph contains a cycle. | `role` |

The last three are thrown while the plugin is being defined, so they
surface as a plugin-definition failure, not as a message error.


## Explain data

When a message is captured with `explain$`, the plugin appends one record
per guarded action. Fields present depend on the path taken.

| Field | Meaning |
|---|---|
| `when`, `msgid`, `msgpat` | Timestamp, message id, the annotated pattern that matched. |
| `options` | The plugin options in force. |
| `ignored`, `ignorepat` | Set when an `ignore` pattern matched. |
| `owner_required` | `false` when the message passed through for lack of an owner record. |
| `owner`, `spec` | The owner record and the spec actually applied. |
| `modifiers` | Which case modifiers ran (`query`, `list`, `entity`) plus `entity_spec`. |
| `role_denied` | `{role, entity, cmd}` for a role denial. |
| `include_custom`, `include_custom_prop` | Result of the include check and the property that failed. |
| `active` | `false` when the spec (or include check) left the message unguarded. |
| `path` | `'list'`, `'remove'`, `'load'`, `'save/create'` or `'save/update'`. |
| `query` | The refined query. |
| `list_len`, `orig_list_len`, `empty` | Result sizes before and after `modifiers.list`. |
| `ent`, `pass`, `query_load` | The loaded row, whether it passed the field checks, and whether it came from a query rather than an id. |
| `field_match_fail` | `{field, ownerFieldName, entityFieldName, ent_val, owner_val}` for the field that blocked a read. |
| `fail` | `{code, details}` for a write failure. |
| `save` | `true` when an update passed its checks. |

See [How-to: debug a decision](how-to.md#debug-why-a-decision-was-made).


## Compatibility

| Requirement | Version |
|---|---|
| Node.js | `>=24` |
| `seneca` | `>=3` (or `>=4.0.0-rc2`) |
| `seneca-entity` | `>=26` |
| `seneca-promisify` | `>=3` |
| `shape` | `>=10` |

The plugin is written in TypeScript (`src/`), published as CommonJS
(`dist/`), and ships its own type declarations.
