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
          member: { scope: 'own', entities: { 'sys/foo': 'rw' } },
          admin: { scope: 'all', entities: '*' }
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
          member: { scope: 'own', entities: { 'sys/foo': 'rw' } },
          admin: { scope: 'all', entities: '*' }
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
          member: { scope: 'own', entities: { 'sys/foo': 'rw' } }
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
          member: { scope: 'own', entities: { 'sys/foo': 'r' } }
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
    const orgowner = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'o0', role: 'orgowner' } }
    })

    const foo = await member.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    const seen = await orgowner.entity('sys/foo').load$(foo.id)
    expect(seen).toMatchObject({ id: foo.id, owner_id: 'u0' })
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
})
