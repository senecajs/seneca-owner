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
        rolesys: true,
        // admin comes from the default preset; only the custom member role
        // needs declaring here.
        roles: {
          member: { grants: [{ entity: 'sys/foo' }] }
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
        rolesys: true,
        // admin (org-scoped, all entities) is the default preset: not declared.
        roles: {
          member: { grants: [{ entity: 'sys/foo' }] }
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
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/foo' }] }
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
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/foo', ops: ['list$', 'load$'] }] }
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


  test('op-gate-allows-save-but-denies-remove', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          // finer than read/write: everything except remove$
          member: { grants: [{ entity: 'sys/foo', ops: ['list$', 'load$', 'save$'] }] }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    const foo = await member.entity('sys/foo').save$({ x: 1 })
    expect(foo).toMatchObject({ x: 1, owner_id: 'u0' })

    // remove$ not granted => silent no-op, row still present
    await member.entity('sys/foo').remove$(foo.id)
    expect(await member.entity('sys/foo').load$(foo.id))
      .toMatchObject({ id: foo.id })
  })


  test('per-entity-grant-relaxes-owner-field', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          // Field-level grant: on sys/public the owner_id read enforcement is
          // turned off, so a member reads every owner's row there, while
          // sys/note stays strictly own-rows. Same role, per-entity spec.
          member: {
            grants: [
              { entity: 'sys/note' },
              { entity: 'sys/public', spec: { read: { owner_id: false } } }
            ]
          }
        }
      })
      .ready()

    const u0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })
    const u1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', role: 'member' } }
    })

    const note = await u0.entity('sys/note').save$({ x: 1 })
    const pub = await u0.entity('sys/public').save$({ y: 2 })
    expect(note).toMatchObject({ owner_id: 'u0' })
    expect(pub).toMatchObject({ owner_id: 'u0' })

    // sys/note stays own-rows: u1 cannot read u0's note.
    expect(await u1.entity('sys/note').load$(note.id)).toEqual(null)

    // sys/public relaxes the owner field: u1 reads u0's public row.
    expect(await u1.entity('sys/public').load$(pub.id))
      .toMatchObject({ id: pub.id, owner_id: 'u0' })
  })


  test('roles-true-uses-default-preset', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        rolesys: true,
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


  test('wildcard-grant-gets-full-access', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: '*' }] }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    // wildcard => rw on any entity, still owner-scoped.
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


  test('entity-listed-without-ops-defaults-all', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          // no ops => all four ops granted
          member: { grants: [{ entity: 'sys/foo' }] },
          admin: { scope: 'org', grants: [{ entity: 'sys/foo' }] }
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
        rolesys: true,
        defaultRole: null,
        roles: {
          member: { grants: [{ entity: 'sys/foo' }] }
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
