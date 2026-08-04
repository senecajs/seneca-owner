# Agents Guide — @seneca/owner

Orientation for AI agents (and new humans) working **on this
repository**. If you are trying to *use* the plugin, read
[`docs/`](docs/) instead — [tutorial](docs/tutorial.md),
[how-to](docs/how-to.md), [reference](docs/reference.md),
[explanation](docs/explanation.md).


## What this project is

`@seneca/owner` is a [Seneca](https://senecajs.org) plugin that enforces
**data ownership and role permissions** on
[`seneca-entity`](https://github.com/senecajs/seneca-entity)
operations. You declare which entity fields identify an owner
(`fields: ['owner_id','org_id']`) and which message patterns to guard
(`annotate: ['sys:entity']`); the plugin then wraps those messages so
that reads are narrowed to the caller's rows, writes are checked against
the stored row, and — when `rolesys` is on — a role's grants decide which
entities and operations are reachable at all.

It does **not** authenticate anyone. It consumes an owner record that a
gateway or auth layer has put on `meta.custom` (`sysowner` by default).


## Repository map

| Path | What it is |
|---|---|
| [`src/Owner.ts`](src/Owner.ts) | The plugin. Option shape, the `checkOwner` wrapper installed on every annotated pattern, the per-command logic (`list`/`load`/`save`/`remove`), and `intern` helpers (`make_spec`, `match`, `deny`, `resolveFieldNames`). |
| [`src/build_roles.ts`](src/build_roles.ts) | Compiles the role DAG into per-role Patruns of entity pattern → `{ops, spec}`. Also `default_roles` (the presets) and `axisName`. |
| [`src/refine_query.ts`](src/refine_query.ts) | Rewrites a query to the owner's field values; handles multi-value axes and public-read flags. |
| [`src/OwnerDoc.ts`](src/OwnerDoc.ts) | `seneca-doc` descriptions. Currently empty and not wired into the plugin return — see [rough edges](#rough-edges). |
| `dist/` | Build output (`tsc -d`). **Committed and imported by the tests** via `require('..')` → `package.main` → `dist/Owner.js`. |
| [`test/`](test/) | `node:test` suites, one dimension per file. `test/helper.js` holds `partial`, `rejects` and `LOG`. |
| [`test/readme.js`](test/readme.js) | The README Quick Example, runnable (`node test/readme.js`). Keep it in step with the README. |
| [`docs/`](docs/) | The four Diátaxis documents. |
| [`ci/`](ci/) | Dormant release workflow plus [`ci/README.md`](ci/README.md), which explains the publishing story (worth reading before any release work). |


## Build and test

```sh
npm run build      # tsc -d  -> dist/   (REQUIRED: tests import dist, not src)
npm test           # node --test "test/**/*.test.js"
npm run watch      # tsc -w -d while iterating
```

**The single most common mistake is editing `src/` and running the tests
without building.** The suite will happily test the previous `dist/`.
`npm run reset` (clean + install + build + test) is the belt-and-braces
version.

Targeted runs:

```sh
TEST_PATTERN=role npm run test-some       # --test-name-pattern
node --test test/role.test.js
SENECA_TEST_LOG=test npm test             # restore Seneca's error logging
```

Tests run Seneca in test mode with logging silenced (`.test(LOG)`, where
`LOG` comes from `test/helper.js`), because many of them deliberately
trigger denials and Seneca logs each expected error with a full stack
trace. Set `SENECA_TEST_LOG` to any Seneca log level to see them again.
Assert on denials by `err.code` via the `rejects` helper — never on log
output.

CI (`.github/workflows/build.yml`) runs `npm install`, `npm run build`,
`npm test` on Ubuntu/Windows/macOS with Node 24.


## How a guarded message flows

`Owner()` wraps each `annotate` pattern with `checkOwner`, which:

1. passes the message straight through if an `ignore` pattern matches;
2. picks the spec (`meta.custom['sys-owner-spec']`, else `default_spec`)
   and the owner record (`meta.custom.sysowner`, dot paths supported);
3. lets a registered `query` case modifier rewrite the spec;
4. when `rolesys` is on and an owner record exists, resolves the role,
   finds the grant for the target entity, checks `msg.cmd` against the
   grant's `ops`, and merges the grant's spec — denying otherwise;
5. checks `include.custom` — if it fails, the message is **not guarded**;
6. dispatches per command: refine the query (`list`, `remove`, `load` by
   query), post-check the row field by field (`load` by id), or inject
   and validate fields (`save`, with a re-load of the existing row on
   update).

Roles are compiled **once, at plugin definition**. Bad role
configuration (`role-scope-unknown`, `role-inherit-cycle`,
`role-inherit-unknown`) therefore throws at startup, which is the
intended behaviour — do not soften those into per-message failures.


## Invariants — do not "fix" these

1. **Quiet reads, loud writes.** A denial gives `[]` for `list`, `null`
   for `load`, a silent no-op for `remove`, and an error for `save`
   (`role-entity-not-allowed`). This asymmetry is deliberate; see
   [explanation](docs/explanation.md#quiet-reads-loud-writes).
2. **No identity means no enforcement.** An instance without the owner
   record (the root instance, internal jobs) is unrestricted, and a
   failed `include.custom` condition leaves a message unguarded rather
   than denying it. The system fails **open** by design; the boundary is
   the gateway that sets identity.
3. **Axis order is the model.** `fields[0]` is the user axis, `fields[1]`
   the tenant axis, and `scope` relaxes only axes *more specific* than
   itself. A role must not be able to leave its tenant except via the
   explicit `scope: '*'`.
4. **Inheritance is explicit.** No role is implied by its name; declaring
   `roles` replaces the presets entirely; an unknown role denies while an
   absent role falls back to `defaultRole`.
5. **`load` by id does not rewrite the query.** It post-checks the row
   instead, to preserve store-level id caching. This is why public-read
   flags do not apply to `load$(id)`.
6. **Grant specs cannot drop an ownership axis.** `make_spec` re-unions
   the fields after merging a grant spec — keep it that way.
7. **Three names per axis.** Spec keys use the raw `fields` entry
   (`'id:owner_id'`), `scope` uses the entity-side name (`'owner_id'`),
   queries and rows use the entity-side name. Mixing them up produces
   rules that silently do nothing.


## Code style

- Prettier: no semicolons, single quotes (`.prettierrc`); `npm run prettier`
  formats the repo.
- Match the surrounding idiom: Yoda comparisons (`'list' === msg.cmd`,
  `null == x`), `const`/`let`, two-space indent, `any`-typed Seneca
  values (the Seneca API is untyped here — do not add speculative
  generics).
- TypeScript is `strict` with `isolatedModules`, targeting ES2019
  CommonJS.
- Comments in `src/` explain *why* a non-obvious mechanism exists
  (coverage unioning, the id-load exception). Keep that density; do not
  narrate the obvious.


## Tests

- `node:test` (`describe`/`test`) with `@hapi/code` `expect`, plus
  `partial` (partial deep equality) and `rejects` (assert `err.code`)
  from `test/helper.js`.
- One dimension per file: `basic`, `gateway`, `role`, `hierarchy`,
  `tenant_key`, `permission`, `convention`, `default_roles`,
  `build_roles` (unit-tests the compiler directly), `refine_query`
  (unit-tests query rewriting), `performance`, `owner` (the older
  end-to-end suite, including case modifiers).
- New behaviour needs a test in the matching file, and a happy path *and*
  a denial — the denial is the point of the plugin.
- `performance.test.js` asserts bounded overhead ratios and prints two
  timing lines; that output is intentional.


## Documentation

`docs/` follows [Diátaxis](https://diataxis.fr) — four documents, four
purposes, no overlap:

| File | Purpose | Rule of thumb |
|---|---|---|
| [`docs/tutorial.md`](docs/tutorial.md) | Learning by doing | A single narrative that works end to end. No option catalogues. |
| [`docs/how-to.md`](docs/how-to.md) | Achieving a task | Independent recipes, each titled with a goal. |
| [`docs/reference.md`](docs/reference.md) | Looking things up | Complete and dry: every option, key, code, field. |
| [`docs/explanation.md`](docs/explanation.md) | Understanding | Rationale and trade-offs. No step-by-step instructions. |

The README keeps its established headings (Install, Quick Example, More
Examples, Motivation, Support, API, Contributing, Background) and links
out to `docs/`.

When you change behaviour: update the reference (always), the how-to (if
there is now a new task worth doing), the explanation (if the *reason*
changed), and the tutorial (only if the basic flow changed). **Verify
every snippet you add by running it** — the previous README example had
drifted to a stale `sys-owner` custom property and silently did nothing.


## Rough edges

Known, deliberate, or not yet done — do not be surprised by these, and
prefer fixing them over documenting around them:

- **`ownerfield` and `explain` options are inert.** `ownerfield` is
  passed into `build_roles` but never read there; `explain` is only
  echoed back in the `config` export. Documented as reserved.
- **`src/OwnerDoc.ts` is empty and unwired**, and the README carries no
  `seneca-doc` markers, so `npm run doc` regenerates nothing. The API
  section is hand-maintained. Wiring `doc: docs` into the plugin return
  and restoring the markers would be a real improvement — do it as an
  explicit change, not a drive-by.
- **`explain$` is not collected for direct entity calls.** It works when
  set on an enclosing message (`seneca.post({..., explain$: log})`).
  `test/gateway.test.js` marks this `TODO: fix explain`.
- **An `annotate` pattern narrower than any registered action breaks
  silently.** `'sys:entity,base:zed'` matches nothing to wrap, so the
  plugin's own `add` becomes a priorless action and every guarded
  operation returns `null`. Guard `'sys:entity'` (optionally
  `'sys:entity,cmd:save'`) and use `ignore` to carve exceptions.
- **`remove` re-lists rows and then removes by the original query**
  rather than by the listed ids (`TODO` in `src/Owner.ts`).
- **Updates cost an extra read.** The pre-load exists so the caller's
  entity is never trusted; it is a known trade-off, not an oversight.


## Releasing

Publishing is *not* automatic. `ci/release.yml` is a dormant workflow;
[`ci/README.md`](ci/README.md) explains how to activate it and why the
tag-matches-version and not-already-published checks exist (6.2.0 shipped
to npm without the role system that `master` already contained).

The local path publishes through **npm staging**: `npm stage publish`
uploads the tarball and defers proof-of-presence (2FA), so the version is
staged first and becomes live only when approved. The scripts assume the
machine already has a logged-in npm session (`npm whoami`); they carry no
credentials of their own.

| Script | What it does |
|---|---|
| `npm run repo-publish` | clean → install → `repo-publish-quick`. |
| `npm run repo-publish-quick` | build → test → `seneca-doc` → `repo-tag` (commit, push, tag, push tags) → `repo-stage-publish`. |
| `npm run repo-publish-dry` / `-quick-dry` | Same chain with `npm stage publish --dry-run` and no tagging. Verifies the tarball contents without uploading. |
| `npm run repo-tag-dry` | Reports the tag it would create, warns if it already exists, and prints `git status`. |
| `npm run repo-stage-publish` | Stage the current version. |
| `npm run repo-stage-list` | List staged versions and their stage ids. |
| `npm run repo-stage-approve` / `-reject` | Promote a staged version to live, or discard it. Takes the stage id: `npm run repo-stage-approve -- <stage-id>`. |

So a release is: bump `package.json` → `npm run repo-publish-dry` to
check → `npm run repo-publish` → `npm run repo-stage-list` →
`npm run repo-stage-approve -- <stage-id>`.

Because `dist/` is committed and is what the tests import, a version bump
with a stale `dist/` republishes the old behaviour — always build before
tagging.

Never publish, tag, or push a release from an agent session unless the
human explicitly asked for exactly that.
