See [AGENTS.md](AGENTS.md) for the full agent guide to this repository.

Quick reminders:

- **Build before testing.** The suite imports `dist/` (`require('..')`),
  not `src/` — `npm run build` after every source change, or `npm run
  watch` while iterating.
- The plugin guards `seneca-entity` messages listed in `annotate`
  (normally `sys:entity`) using the owner record on
  `meta.custom.sysowner`. No owner record means **no enforcement** — that
  is by design, not a bug to fix.
- Denials are quiet on reads (`[]` / `null` / no-op) and loud on writes
  (`role-entity-not-allowed`, `create-not-allowed`,
  `update-not-allowed`, `save-not-found`). Assert on `err.code`.
- Roles compile once at plugin definition (`src/build_roles.ts`), so bad
  role config fails at startup. `fields` order defines the axes; `scope`
  relaxes only the axes more specific than itself.
- Tests use `.test(LOG)` from `test/helper.js` to keep expected-denial
  logging quiet; `SENECA_TEST_LOG=test npm test` brings the errors back.
- Docs are Diátaxis-split under `docs/` (tutorial, how-to, reference,
  explanation). Update the reference for any behaviour change, and run
  every snippet you write.
- Never publish, tag or push a release unless explicitly asked.
