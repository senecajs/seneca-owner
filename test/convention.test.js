/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const { describe, test } = require('node:test')
const { expect } = require('@hapi/code')
const { LOG, partial, rejects } = require('./helper')

const Seneca = require('seneca')
const Plugin = require('..')

// Declaring roles replaces the presets entirely: no member/admin is injected,
// so the caller's set is exactly what is enforced.

const build = (roles) =>
  Seneca({ legacy: false })
    .test(LOG)
    .use('promisify')
    .use('entity')
    .use(Plugin, {
      fields: ['owner_id', 'org_id'],
      annotate: ['sys:entity'],
      rolesys: true,
      roles
    })
    .ready()

const as = (s0, owner_id, org_id, role) =>
  s0.delegate(null, { custom: { sysowner: { owner_id, org_id, role } } })

describe('convention', () => {

  // Declaring roles replaces the presets: no hidden member/admin is injected,
  // so undeclared roles get nothing.
  test('declared-roles-replace-presets', async () => {
    const s0 = await build({
      manager: { scope: 'org_id', grants: [{ entity: '*' }] }
    })

    const gA = as(s0, 'g0', 'A', 'manager')
    const gB = as(s0, 'g1', 'B', 'manager')
    const mA = as(s0, 'u0', 'A', 'member') // undeclared
    const oA = as(s0, 'o0', 'A', 'admin')   // undeclared

    const note = await gA.entity('sys/note').save$({ x: 1 })
    partial(note, { owner_id: 'g0', org_id: 'A' })

    // manager reads across owners in its org, still bounded by org_id.
    partial(await gA.entity('sys/note').load$(note.id), { id: note.id })
    expect(await gB.entity('sys/note').load$(note.id)).to.equal(null)

    // member and admin are not declared, so they get no preset: denied.
    for (const actor of [mA, oA]) {
      expect(await actor.entity('sys/note').load$(note.id)).to.equal(null)
      await rejects(actor.entity('sys/note').save$({ x: 2 }), { code: 'role-entity-not-allowed' })
    }
  })


  // All custom: caller declares every role (member and admin included), so no
  // default is injected. Distinct grants, org scope and bad actors validated.
  test('all-custom-roles', async () => {
    const s0 = await build({
      member: { grants: [{ entity: 'sys/ticket' }] },
      support: { scope: 'org_id', grants: [{ entity: 'sys/ticket' }] },
      admin: { scope: 'org_id', inherits: ['member'], grants: [{ entity: 'sys/billing' }] }
    })

    const mA0 = as(s0, 'u0', 'A', 'member')
    const mA1 = as(s0, 'u1', 'A', 'member')
    const sA = as(s0, 's0', 'A', 'support')
    const sB = as(s0, 's1', 'B', 'support')
    const oA = as(s0, 'o0', 'A', 'admin')
    const mC0 = as(s0, 'w0', 'C', 'member')

    const tA = await mA0.entity('sys/ticket').save$({ x: 1 })
    const tC = await mC0.entity('sys/ticket').save$({ x: 2 })

    // happy: admin writes billing; support and admin read tickets across the org.
    const bill = await oA.entity('sys/billing').save$({ amount: 10 })
    partial(bill, { owner_id: 'o0', org_id: 'A' })
    partial(await sA.entity('sys/ticket').load$(tA.id), { id: tA.id })
    partial(await oA.entity('sys/ticket').load$(tA.id), { id: tA.id })

    // denials by ownership / org.
    expect(await mA1.entity('sys/ticket').load$(tA.id)).to.equal(null)
    expect(await sB.entity('sys/ticket').load$(tA.id)).to.equal(null)
    expect(await sA.entity('sys/ticket').load$(tC.id)).to.equal(null)

    // bad actor: member and support cannot reach the admin-only billing entity.
    await rejects(mA0.entity('sys/billing').save$({ amount: 1 }), { code: 'role-entity-not-allowed' })
    await rejects(sA.entity('sys/billing').save$({ amount: 1 }), { code: 'role-entity-not-allowed' })

    // bad actor: an entity granted to no role is denied for everyone.
    for (const actor of [mA0, sA, oA]) {
      expect(await actor.entity('sys/secret').load$('any-id')).to.equal(null)
      await rejects(actor.entity('sys/secret').save$({ z: 1 }), { code: 'role-entity-not-allowed' })
    }

    const listSA = await sA.entity('sys/ticket').list$()
    expect(listSA.every((r) => r.org_id === 'A')).to.equal(true)
  })
})
