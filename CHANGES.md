# Changes

## 7.0.0 2026-11-21

First entry of this change log. Earlier versions are on npm and in the
git history.

* Seneca 4: the peer dependency is `seneca` `^4.0.0` (was
  `>=3||>=4.0.0-rc2`). Seneca 3 users stay on `@seneca/owner@6`.
* The entity peer dependency is `@seneca/entity` `^29.0.0`. The peer
  dependency `seneca-entity` `>=26` is removed: npm installed
  seneca-entity 28 for it, and that version stops Seneca 4 at startup
  with `plugin_gubu_shape`.
* The peer dependency `seneca-promisify` is removed. Seneca 4 has
  promises built in and deprecates the promisify plugin (D4). Do not
  load it.
* The peer dependency `shape` is removed, and the plugin no longer
  imports `shape` (B15). The option defaults are now a function of the
  `valid` builders that Seneca passes in, exported as `defaults`, and
  Seneca validates the options. An unknown option or a value of the
  wrong type now stops the plugin with `invalid_plugin_option`. Because
  Seneca now fills in the defaults, the plugin needs Seneca's plugin
  option validation, which is on by default (`valid.active` and
  `valid.plugin`).
* `seneca.util.deepextend` is replaced by `seneca.util.deep` (D2), so
  the plugin prints no deprecation warning.
* Node.js 24 or later (`engines.node` `>=24`), as before.
