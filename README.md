![Seneca](http://senecajs.org/files/assets/seneca-logo.png)
> A [Seneca.js](http://senecajs.org) plugin

# @seneca/owner

[![npm version](https://img.shields.io/npm/v/@seneca/owner.svg)](https://npmjs.com/package/@seneca/owner)
[![build](https://github.com/senecajs/seneca-owner/actions/workflows/build.yml/badge.svg)](https://github.com/senecajs/seneca-owner/actions/workflows/build.yml)
[![Known Vulnerabilities](https://snyk.io/test/github/senecajs/seneca-owner/badge.svg)](https://snyk.io/test/github/senecajs/seneca-owner)
[![Coverage Status](https://coveralls.io/repos/voxgig/seneca-owner/badge.svg?branch=master&service=github)](https://coveralls.io/github/voxgig/seneca-owner?branch=master)
[![DeepScan grade](https://deepscan.io/api/teams/5016/projects/12956/branches/208825/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=5016&pid=12956&bid=208825)

| ![Voxgig](https://www.voxgig.com/res/img/vgt01r.png) | This open source module is sponsored and supported by [Voxgig](https://www.voxgig.com). |
|---|---|

Ownership and role permissions for [seneca-entity](https://github.com/senecajs/seneca-entity)
data. Declare which fields identify the owner of a row, and every entity
message is scoped to the calling user, their organisation, and their
role — without an ownership clause anywhere in your application code.

## Install

```sh
npm install @seneca/owner
```

## Documentation

The documentation follows the four [Diátaxis](https://diataxis.fr)
modes — start with whichever matches what you are doing:

| | |
|---|---|
| [Tutorial](docs/tutorial.md) | Learning: build up ownership, tenants and roles step by step. |
| [How-to guide](docs/how-to.md) | Doing: gateway wiring, read-only roles, public rows, transfers, debugging. |
| [Reference](docs/reference.md) | Looking up: every option, grant key, message, error code and explain field. |
| [Explanation](docs/explanation.md) | Understanding: axes, scopes, compiled roles, and why denials are quiet on reads and loud on writes. |

Working on this repository with an AI agent? See
[`AGENTS.md`](AGENTS.md) (and [`CLAUDE.md`](CLAUDE.md)).

## Quick Example

```js
require('seneca')({ legacy: false })
  .test()
  .use('promisify')
  .use('entity')
  .use('owner', {
    // Ownership axes, most specific first: user, then tenant.
    fields: ['usr', 'org'],

    // Guard every seneca-entity operation.
    annotate: ['sys:entity'],
  })
  .ready(async function () {

    // Set custom property to identify user

    var alice_instance = this.delegate(null, {custom: {
      sysowner: {
        usr: 'alice',
        org: 'wonderland'
      }
    }})

    var bob_instance = this.delegate(null, {custom: {
      sysowner: {
        usr: 'bob',
        org: 'wonderland'
      }
    }})

    // Save some entities

    var save_a1 = await alice_instance.entity('zed/foo').data$({id$:1,a:1}).save$()
    var save_a2 = await bob_instance.entity('zed/foo').data$({id$:2,a:2}).save$()

    // usr and org fields are injected from the sysowner custom property
    console.log(save_a1) // $-/zed/foo;id=1;{a:1,usr:alice,org:wonderland}
    console.log(save_a2) // $-/zed/foo;id=2;{a:2,usr:bob,org:wonderland}

    // Users can load their own data
    var load_a1 = await alice_instance.entity('zed/foo').load$(1)
    var load_a2 = await bob_instance.entity('zed/foo').load$(2)

    console.log(load_a1) // $-/zed/foo;id=1;{a:1,usr:alice,org:wonderland}
    console.log(load_a2) // $-/zed/foo;id=2;{a:2,usr:bob,org:wonderland}

    // Users can't load other user's data
    var not_a2 = await alice_instance.entity('zed/foo').load$(2)
    var not_a1 = await bob_instance.entity('zed/foo').load$(1)

    console.log(not_a2) // null
    console.log(not_a1) // null

    // Nor list it, nor remove it (a silent no-op)
    console.log(await bob_instance.entity('zed/foo').list$()) // [ id=2 ]
    await bob_instance.entity('zed/foo').remove$(1)
    console.log(await alice_instance.entity('zed/foo').load$(1)) // still there
  })
```

This example runs as [`test/readme.js`](test/readme.js) (loading the
plugin from the local build), so it stays honest: `node test/readme.js`.

A Seneca instance with no `sysowner` custom property — the root instance
above — is unrestricted. Ownership applies to callers that have an
identity; internal code that has none is not affected.

## Roles

Ownership answers *whose row is this?*. Roles answer *what may this
caller do, and how far does their reach extend?*. Set `rolesys: true` to
turn them on:

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

- **`grants`** say which entities a role may touch, and with which
  operations (`list$`, `load$`, `save$`, `remove$`). Entity patterns may
  be exact (`sys/doc`), a whole base (`sys` or `sys/*`) or everything
  (`*`).
- **`inherits`** is an explicit DAG: effective permissions are the union
  of every inherited role plus the role's own grants. Nothing is implied
  by a role's name.
- **`scope`** relaxes the ownership axes *more specific* than the named
  one. `scope: 'org_id'` gives a role its whole organisation — and never
  another one. `scope: '*'` is the only way out of a tenant.

The caller's role comes from the `role` property of the owner record.
With `rolesys: true` and no `roles` declared you get two presets:
`member` (own rows, any entity) and `admin` (the whole tenant, any
entity). Declaring roles replaces the presets entirely.

Denials are quiet on reads and loud on writes: `list$` gives `[]`,
`load$` gives `null`, `remove$` does nothing, and `save$` rejects with
`role-entity-not-allowed`.

## More Examples

The test suite is a worked-example catalogue — each file covers one
dimension:

| Test | Shows |
|---|---|
| [`test/basic.test.js`](test/basic.test.js) | Plain single-axis ownership. |
| [`test/gateway.test.js`](test/gateway.test.js) | Identity from a gateway principal (`ownerprop`, field mapping, `ignore`). |
| [`test/role.test.js`](test/role.test.js) | Grants, ops, wildcards, unknown roles, `defaultRole`. |
| [`test/hierarchy.test.js`](test/hierarchy.test.js) | Inheritance chains and org scoping. |
| [`test/tenant_key.test.js`](test/tenant_key.test.js) | A tenant axis that is not called `org_id`. |
| [`test/permission.test.js`](test/permission.test.js) | Multi-role setups, including bad-actor cases. |
| [`test/convention.test.js`](test/convention.test.js) | Declared roles replacing the presets. |
| [`test/owner.test.js`](test/owner.test.js) | Per-message specs, and group permissions via case modifiers (`org-scenario`). |

## Motivation

Provides ownership permissions for entities in Seneca. Ensures users can
only access and modify their own data.

The check is a property of the data model, not of each call site, so it
belongs in one declaration rather than in every service method. Applying
it at the message layer means nothing can reach the store without passing
through it, and the rules stay independent of which store you use. See
[Explanation](docs/explanation.md) for the full reasoning.

## Support

If you're using this module and need help, you can:

- Post a [github issue](https://github.com/senecajs/seneca-owner/issues)
- Tweet to [@senecajs](http://twitter.com/senecajs)
- Ask on the [Gitter](https://gitter.im/senecajs/seneca)

## API

Full details: [reference](docs/reference.md).

### Options

| Option | Default | Description |
|---|---|---|
| `fields` | `[]` | Ownership axes, most specific first. `'owner_id'` or `'owner_field:entity_field'`. |
| `annotate` | `[]` | Message patterns to guard. Must match registered actions — usually `'sys:entity'`. |
| `ignore` | `[]` | Patterns to pass through unguarded. |
| `rolesys` | `false` | Enable role enforcement. |
| `roles` | *(presets)* | Role definitions: `{scope, inherits, grants}`. |
| `defaultRole` | `'member'` | Role for an owner record with no `role`; `null` denies. |
| `ownerprop` | `'sysowner'` | `meta.custom` key holding the owner record (dot paths supported). |
| `specprop` | `'sys-owner-spec'` | `meta.custom` key holding a per-message spec. |
| `caseprop` | `'case$'` | Owner-record property naming a registered case. |
| `default_spec` | *(see reference)* | Base `read`/`write`/`inject`/`alter`/`public` rules. |
| `include.custom` | *(owner record exists)* | Extra activation conditions on `meta.custom`. |
| `owner_required` | `true` | When `false`, messages with no owner record skip ownership entirely. |

### Action Patterns

* [hook:case,sys:owner](#-hookcasesysowner-)

### Action Descriptions

#### &laquo; `hook:case,sys:owner` &raquo;

Register a named set of *case modifiers*: functions that adjust the
ownership rules at runtime, selected per caller by the `case$` property
of the owner record. Use these when a permission depends on data the
static configuration cannot know — group membership, a support session, a
feature flag.

| Property | Type | Description |
|---|---|---|
| `case` | `string` | Case name, matched against the owner record's `case$`. |
| `modifiers.query` | `(spec, owner, msg) => spec` | Rewrite the rules for this caller, before ownership is applied. |
| `modifiers.list` | `(spec, owner, msg, list) => list` | Filter or transform rows returned by `list` (and the pre-check of `remove`). |
| `modifiers.entity` | `(spec, owner, msg, ent) => spec` | Adjust the rules on `load` by id, using the loaded row. |

```js
seneca.act('sys:owner,hook:case,case:support', {
  modifiers: {
    query: function (spec, owner, msg) {
      spec.read.owner_id = false     // support staff read across users…
      spec.write.owner_id = false
      return spec                    // …but org_id still bounds them
    },
  },
})
```

Registering the same case name again replaces its modifiers.

### Exports

| Export | Description |
|---|---|
| `Owner/make_spec` | Expand a partial spec against `default_spec` — build `specprop` values with this. |
| `Owner/casemap` | Live map of case name to registered modifiers. |
| `Owner/config` | The normalised default spec and validated options. |

### Debugging

Ownership rules can become complex. To debug individual use-cases, in production or otherwise, use the `Seneca.explain` feature.

```js
var explain_log = []
await seneca.post('cmd:do-stuff', {explain$: explain_log})
console.log(explain_log) // A record of message calls and custom debug information.
```

Each guarded action appends a record saying what it decided and why: the
owner record and spec applied, the refined query, `field_match_fail` for
a read that did not match, `fail` for a rejected write, `role_denied` for
a role denial. See
[reference: explain data](docs/reference.md#explain-data).

The _explain_ functionality is also supported by [seneca-browser](https://github.com/voxgig/seneca-browser), so you can use it directly in the browser console. You may find it more useful to use the general capture:

```js
var explain_log = seneca.explain(true)
// ... user interface actions that generate requests
console.log(explain_log)
```

## Contributing

The [Senecajs org](https://github.com/senecajs/) encourages open participation. If you feel you can help in any way, be it with documentation, examples, extra testing, or new features please get in touch.

The plugin is written in TypeScript under `src/` and published from
`dist/` — run `npm run build` (or `npm run watch`) after changing
sources, since the tests import `dist/`. Documentation lives in
[`docs/`](docs/) and follows the four Diátaxis modes; when behaviour
changes, update the matching document as well as the tests.

### Running tests

```sh
npm run test
```

```sh
npm run build            # tsc -d, required before tests see your changes
TEST_PATTERN=role npm run test-some
SENECA_TEST_LOG=test npm run test    # restore Seneca error logs while debugging
```

## Background

Works with [seneca-entity](https://github.com/senecajs/seneca-entity) to enforce data ownership.

Entity operations are Seneca messages (`sys:entity`), so the plugin
enforces ownership by wrapping those messages: reads have the owner's
values added to the query before the store sees them, and writes are
checked against the stored row. Roles are compiled once at startup into a
per-role pattern matcher, so enforcement costs one lookup per message
regardless of hierarchy depth or table size.
