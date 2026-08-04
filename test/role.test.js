/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const { describe, test } = require('node:test')
const { expect } = require('@hapi/code')
const { LOG, partial, rejects } = require('./helper')

const Seneca = require('seneca')
const Plugin = require('..')

describe('role', () => {

  test('member-sees-own-rows-only', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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

    const u0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })
    const u1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', role: 'member' } }
    })

    const foo = await u0.entity('sys/foo').save$({ x: 1 })
    partial(foo, { x: 1, owner_id: 'u0' })

    const own = await u0.entity('sys/foo').load$(foo.id)
    partial(own, { id: foo.id, owner_id: 'u0' })

    const notOwned = await u1.entity('sys/foo').load$(foo.id)
    expect(notOwned).to.equal(null)
  })


  test('admin-sees-across-owners', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/foo' }] },
          // no tenant axis declared, so a global admin scopes with '*'
          admin: { scope: '*', grants: [{ entity: '*' }] }
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
    partial(seen, { id: foo.id, owner_id: 'u0' })
  })


  test('undeclared-entity-is-denied', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    expect(load).to.equal(null)

    const list = await member.entity('sys/bar').list$()
    expect(list).to.equal([])

    await rejects(member.entity('sys/bar').save$({ x: 1 }), { code: 'role-entity-not-allowed' })
  })


  test('read-only-grant-blocks-write', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    partial(read, { id: seed.id, owner_id: 'u0' })

    await rejects(member.entity('sys/foo').save$({ y: 2 }), { code: 'role-entity-not-allowed' })
  })


  test('op-gate-allows-save-but-denies-remove', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    partial(foo, { x: 1, owner_id: 'u0' })

    // remove$ not granted => silent no-op, row still present
    await member.entity('sys/foo').remove$(foo.id)
    partial(await member.entity('sys/foo').load$(foo.id), { id: foo.id })
  })


  test('per-entity-grant-relaxes-owner-field', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    partial(note, { owner_id: 'u0' })
    partial(pub, { owner_id: 'u0' })

    // sys/note stays own-rows: u1 cannot read u0's note.
    expect(await u1.entity('sys/note').load$(note.id)).to.equal(null)

    // sys/public relaxes the owner field: u1 reads u0's public row.
    partial(await u1.entity('sys/public').load$(pub.id), { id: pub.id, owner_id: 'u0' })
  })


  test('no-roles-uses-default-preset', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id'],
        annotate: ['sys:entity'],
        rolesys: true,
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })
    const admin = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'o0', role: 'admin' } }
    })

    const foo = await member.entity('sys/foo').save$({ x: 1 })
    partial(foo, { x: 1, owner_id: 'u0' })

    const seen = await admin.entity('sys/foo').load$(foo.id)
    partial(seen, { id: foo.id, owner_id: 'u0' })
  })


  test('wildcard-grant-gets-full-access', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    partial(foo, { x: 1, owner_id: 'u0' })

    const bar = await member.entity('sys/bar').save$({ y: 2 })
    partial(bar, { y: 2, owner_id: 'u0' })

    const readFoo = await member.entity('sys/foo').load$(foo.id)
    partial(readFoo, { id: foo.id, owner_id: 'u0' })

    // Still owner-scoped: another member cannot read u0's row.
    const u1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', role: 'member' } }
    })
    const notOwned = await u1.entity('sys/foo').load$(foo.id)
    expect(notOwned).to.equal(null)
  })


  test('no-roles-is-plain-ownership', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    partial(foo, { x: 1, owner_id: 'u0' })

    const notOwned = await u1.entity('sys/foo').load$(foo.id)
    expect(notOwned).to.equal(null)
  })


  test('explicit-unknown-role-denied-not-default', async () => {
    // An explicit unknown role must deny; only an absent role uses defaultRole.
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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

    const unknown = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', role: 'hacker' } }
    })
    const absent = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u2' } }
    })

    // unknown role: no permissions, even though member exists
    expect(await unknown.entity('sys/foo').load$('any-id')).to.equal(null)
    expect(await unknown.entity('sys/foo').list$()).to.equal([])
    await rejects(unknown.entity('sys/foo').save$({ x: 1 }), { code: 'role-entity-not-allowed' })

    // absent role resolves to defaultRole (member)
    const foo = await absent.entity('sys/foo').save$({ x: 2 })
    partial(foo, { x: 2, owner_id: 'u2' })
  })


  test('defaultRole-null-denies-unknown-role', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    partial(foo, { x: 1, owner_id: 'u0' })

    // unknown role denied entirely
    expect(await unknown.entity('sys/foo').load$('any-id')).to.equal(null)
    expect(await unknown.entity('sys/foo').list$()).to.equal([])
    await rejects(unknown.entity('sys/foo').save$({ x: 2 }), { code: 'role-entity-not-allowed' })
  })
})
