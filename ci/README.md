# Release workflow (dormant)

`ci/release.yml` publishes this package to npm when a version tag is
pushed. It is **inert** where it sits — GitHub only runs workflows under
`.github/workflows/` (this repo's active ones are `build.yml` and
`todo.yml`).

It is deliberately not activated for you: a workflow that can publish
should be reviewed and given a token by a human, not switched on as a
side effect.

## Why this exists

The local publish path is:

```
npm run repo-publish
  -> aql vault exec --for=npm vxg:pub01 -- npm stage publish ...
```

which needs the `aql` vault CLI **and** a logged-in npm session on
whichever machine runs it. Publishing from CI needs neither on any
individual machine — the token lives in the repository's secrets and a
tag is the trigger. It also gets you npm **provenance** attestation,
which a local publish does not.

## Activate

1. Create an npm **automation** token with publish rights on the
   `@seneca` scope (automation tokens bypass 2FA, which is what CI needs).
2. Add it as a repository secret named `NPM_TOKEN`
   (*Settings → Secrets and variables → Actions*).
3. Move the workflow:

```bash
git mv ci/release.yml .github/workflows/release.yml
git commit -m 'ci: activate release workflow'
```

## Release

```bash
# 1. bump package.json
# 2. commit it
git tag v6.3.0
git push origin v6.3.0
```

The workflow installs, builds, tests, checks the tag matches
`package.json`, checks the version is not already on npm, then publishes
with provenance.

Before activating, dry-run it from the Actions tab
(*release → Run workflow*) — that path packs and verifies without
publishing, and needs no token.

## The check that would have caught the current mess

`main` carried the entire role-based access control system — `rolesys`,
`roles`, `build_roles.ts`, `refine_query.ts` — under version **6.2.0**,
the version *already published to npm*. So `npm i @seneca/owner` returned
a build with none of it, and any config using `rolesys` was rejected at
plugin load:

```
Plugin Owner: option value is not valid
```

followed by a `plugin:define` timeout. Nothing in the source hinted at
it, because the source was correct — only the published artifact was
stale.

The `tag matches package version` and `version is not already published`
steps make that specific failure impossible to repeat: you cannot tag
6.2.0 again, and you cannot tag 6.3.0 while `package.json` says 6.2.0.

## Downstream

`voxgig/create-system` scaffolds `@seneca/owner: 6.3.0`, and
`metsitaba/todo-app` vendors a tarball of this source as a stopgap. Both
start working from the registry the moment 6.3.0 is published; the
vendored tarball and its `tm/env/docker/Dockerfile.frag` workaround can
then be deleted.
