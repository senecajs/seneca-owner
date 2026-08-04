/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

// The README "Quick Example", runnable against the local build:
//   node test/readme.js
// Published code would use .use('owner', {...}) instead of .use('..', {...}).

require('seneca')({ legacy: false })
  .test()
  .use('promisify')
  .use('entity')
  .use('..', {
    // Ownership axes, most specific first: user, then tenant.
    fields: ['usr', 'org'],

    // Guard every seneca-entity operation.
    annotate: ['sys:entity'],
  })
  .ready(async function () {
    // Set custom property to identify user

    var alice_instance = this.delegate(null, {
      custom: {
        sysowner: {
          usr: 'alice',
          org: 'wonderland',
        },
      },
    })

    var bob_instance = this.delegate(null, {
      custom: {
        sysowner: {
          usr: 'bob',
          org: 'wonderland',
        },
      },
    })

    // Save some entities

    var save_a1 = await alice_instance
      .entity('zed/foo')
      .data$({ id$: 1, a: 1 })
      .save$()
    var save_a2 = await bob_instance
      .entity('zed/foo')
      .data$({ id$: 2, a: 2 })
      .save$()

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
