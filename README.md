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

## Install

```sh
npm install @seneca/owner
```

## Quick Example

```js
require('seneca')
  .test()
  .use('promisify')
  .use('entity')
  .use('owner', {
    fields: ['usr','org'],
    annotate: [
      'role:entity,cmd:save,base:zed',
      'role:entity,cmd:load,base:zed',
      'role:entity,cmd:list,base:zed',
      'role:entity,cmd:remove,base:zed',
    ]
  })
  .ready(async function() {

    // Set custom property to identify user

    var alice_instance = this.delegate(null,{custom:{
      'sys-owner': {
        usr: 'alice',
        org: 'wonderland'
      }
    }})

    var bob_instance = this.delegate(null,{custom:{
      'sys-owner': {
        usr: 'bob',
        org: 'wonderland'
      }
    }})

    // Save some entities

    var save_a1 = await alice_instance.entity('zed/foo').data$({id$:1,a:1}).save$()
    var save_a2 = await bob_instance.entity('zed/foo').data$({id$:2,a:2}).save$()

    // usr and org fields are injected from sys-owner custom property
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
  })
```

## More Examples

For an example showing groups with custom permissions, see the `group-scenario` unit test.

## Motivation

Provides ownership permissions for entities in Seneca. Ensures users can only access and modify their own data.

## Support

If you're using this module and need help, you can:

- Post a [github issue](https://github.com/senecajs/seneca-owner/issues)
- Tweet to [@senecajs](http://twitter.com/senecajs)
- Ask on the [Gitter](https://gitter.im/senecajs/seneca)

## API

### Action Patterns

* [hook:case,sys:owner](#-hookcasesysowner-)

### Action Descriptions

#### &laquo; `hook:case,sys:owner` &raquo;

No description provided.

### Debugging

Ownership rules can become complex. To debug individual use-cases, in production or otherwise, use the `Seneca.explain` feature.

```js
var explain_log = []
await seneca.post('cmd:do-stuff', {explain$: explain_log})
console.log(explain_log) // A record of message calls and custom debug information.
```

The _explain_ functionality is also supported by [seneca-browser](https://github.com/voxgig/seneca-browser), so you can use it directly in the browser console. You may find it more useful to use the general capture:

```js
var explain_log = seneca.explain(true)
// ... user interface actions that generate requests
console.log(explain_log)
```

## Contributing

The [Senecajs org](https://github.com/senecajs/) encourages open participation. If you feel you can help in any way, be it with documentation, examples, extra testing, or new features please get in touch.

### Running tests

```sh
npm run test
```

## Background

Works with [seneca-entity](https://github.com/senecajs/seneca-entity) to enforce data ownership.
