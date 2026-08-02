/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const { describe, test } = require('node:test')
const { expect } = require('@hapi/code')
const { partial } = require('./helper')

const Seneca = require('seneca')
const Plugin = require('..')

// rolesys:true with NO roles declared falls back to the built-in presets:
// member = own rows on any entity, admin = whole tenant on any entity. Both
// stay bounded by the tenant axis (org_id) — a role never leaves its tenant.

describe('default-roles', () => {

  test('member-default-is-wildcard-but-owner-and-tenant-bounded', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'org_id'],
        annotate: ['sys:entity'],
        rolesys: true
        // no roles declared -> defaults_roles applies
      })
      .ready()

    // no role key -> defaultRole 'member'
    const memberA0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', org_id: 'A' } }
    })
    const memberA1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', org_id: 'A' } }
    })
    const memberB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'v0', org_id: 'B' } }
    })

    // wildcard: member writes own rows on ANY entity, always stamped with both axes
    const note = await memberA0.entity('sys/note').save$({ x: 1 })
    partial(note, { owner_id: 'u0', org_id: 'A' })
    const misc = await memberA0.entity('qux/zed').save$({ x: 2 })
    partial(misc, { owner_id: 'u0', org_id: 'A' })

    // owner axis enforced: a same-tenant peer cannot see another member's row
    expect(await memberA1.entity('sys/note').load$(note.id)).to.equal(null)
    // tenant axis enforced: a different tenant cannot see it either
    expect(await memberB.entity('sys/note').load$(note.id)).to.equal(null)
  })


  test('admin-default-reads-whole-tenant-but-never-crosses-it', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'org_id'],
        annotate: ['sys:entity'],
        rolesys: true
      })
      .ready()

    const memberA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', org_id: 'A' } }
    })
    const adminA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', org_id: 'A', role: 'admin' } }
    })
    const adminB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'b0', org_id: 'B', role: 'admin' } }
    })

    const note = await memberA.entity('sys/note').save$({ x: 1 })

    // owner axis relaxed: admin sees a peer's row within its own tenant
    partial(await adminA.entity('sys/note').load$(note.id), { id: note.id, owner_id: 'u0', org_id: 'A' })

    // tenant axis still enforced: admin of another tenant is blocked
    expect(await adminB.entity('sys/note').load$(note.id)).to.equal(null)

    const listA = await adminA.entity('sys/note').list$()
    expect(listA.every((r) => r.org_id === 'A')).to.equal(true)
  })
})
