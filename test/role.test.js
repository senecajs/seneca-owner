/* Copyright (c) 2018-2023 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

describe('role', () => {

  test('member-sees-own-rows-only', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        roles: {
          member: { scope: 'own', entities: ['sys/foo'] },
          admin: { scope: 'all', entities: true }
        }
      })
      .ready()

    const u0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })
    const u1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', role: 'member' } }
    })

    const foo = await u0.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    const own = await u0.entity('sys/foo').load$(foo.id)
    expect(own).toMatchObject({ id: foo.id, owner_id: 'u0' })

    const notOwned = await u1.entity('sys/foo').load$(foo.id)
    expect(notOwned).toEqual(null)
  })


  test('admin-sees-across-owners', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        roles: {
          member: { scope: 'own', entities: ['sys/foo'] },
          admin: { scope: 'all', entities: true }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })
    const admin = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', role: 'admin' } }
    })

    const foo = await member.entity('sys/foo').save$({ x: 1 })

    const seen = await admin.entity('sys/foo').load$(foo.id)
    expect(seen).toMatchObject({ id: foo.id, owner_id: 'u0' })
  })


  test('undeclared-entity-is-denied', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        roles: {
          member: { scope: 'own', entities: ['sys/foo'] }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    const load = await member.entity('sys/bar').load$('any-id')
    expect(load).toEqual(null)

    const list = await member.entity('sys/bar').list$()
    expect(list).toEqual([])

    await expect(member.entity('sys/bar').save$({ x: 1 }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })
  })


  test('read-only-grant-blocks-write', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        roles: {
          member: { scope: 'own', entities: [{ 'sys/foo': { read: true } }] }
        }
      })
      .ready()

    // seed via root instance (no owner => plain, unscoped save)
    const seed = await s0.entity('sys/foo').save$({ owner_id: 'u0', y: 1 })

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    const read = await member.entity('sys/foo').load$(seed.id)
    expect(read).toMatchObject({ id: seed.id, owner_id: 'u0' })

    await expect(member.entity('sys/foo').save$({ y: 2 }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })
  })


  test('roles-true-uses-default-preset', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        roles: true
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })
    const admin = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'o0', role: 'admin' } }
    })

    const foo = await member.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    const seen = await admin.entity('sys/foo').load$(foo.id)
    expect(seen).toMatchObject({ id: foo.id, owner_id: 'u0' })
  })


  test('role-no-entities-gets-full-access', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        roles: {
          member: { scope: 'own' },
          admin: { scope: 'all' }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    // No entities declared => rw on any entity, still owner-scoped.
    const foo = await member.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    const bar = await member.entity('sys/bar').save$({ y: 2 })
    expect(bar).toMatchObject({ y: 2, owner_id: 'u0' })

    const readFoo = await member.entity('sys/foo').load$(foo.id)
    expect(readFoo).toMatchObject({ id: foo.id, owner_id: 'u0' })

    // Still owner-scoped: another member cannot read u0's row.
    const u1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', role: 'member' } }
    })
    const notOwned = await u1.entity('sys/foo').load$(foo.id)
    expect(notOwned).toEqual(null)
  })


  test('entity-listed-without-op-defaults-rw', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        roles: {
          // boolean flag and array form both => rw
          member: { scope: 'own', entities: ['sys/foo'] },
          admin: { scope: 'all', entities: ['sys/foo'] }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    const foo = await member.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    const read = await member.entity('sys/foo').load$(foo.id)
    expect(read).toMatchObject({ id: foo.id, owner_id: 'u0' })

    // allowlist still applies: sys/bar undeclared => denied
    const bar = await member.entity('sys/bar').load$('any-id')
    expect(bar).toEqual(null)
  })


  test('no-roles-is-plain-ownership', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity']
      })
      .ready()

    const u0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0' } }
    })
    const u1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1' } }
    })

    const foo = await u0.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    const notOwned = await u1.entity('sys/foo').load$(foo.id)
    expect(notOwned).toEqual(null)
  })


  test('defaultRole-null-denies-unknown-role', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        defaultRole: null,
        roles: {
          member: { scope: 'own', entities: ['sys/foo'] }
        }
      })
      .ready()

    const known = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })
    const unknown = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', role: 'hacker' } }
    })

    const foo = await known.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    // unknown role denied entirely
    expect(await unknown.entity('sys/foo').load$('any-id')).toEqual(null)
    expect(await unknown.entity('sys/foo').list$()).toEqual([])
    await expect(unknown.entity('sys/foo').save$({ x: 2 }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })
  })
})
