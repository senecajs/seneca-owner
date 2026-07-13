/* Copyright (c) 2018-2023 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

// Convention over configuration for the role set itself. With no roles
// declared, member (own rows) and admin (whole tenant) apply. Declaring any
// roles replaces the presets entirely: no member/admin is injected, so the
// caller's set is exactly what is enforced. Scenarios span tenants A, B, C to
// prove the org scope holds.

const build = (roles) =>
  Seneca({ legacy: false })
    .test()
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

  // No role declared: rely entirely on the built-in member/admin defaults.
  test('default-member-and-admin-roles', async () => {
    const s0 = await build(true)

    const mA0 = as(s0, 'u0', 'A', 'member')
    const mA1 = as(s0, 'u1', 'A', 'member')
    const mB0 = as(s0, 'v0', 'B', 'member')
    const mC0 = as(s0, 'w0', 'C', 'member')
    const oA = as(s0, 'o0', 'A', 'admin')
    const oB = as(s0, 'p0', 'B', 'admin')

    const nA = await mA0.entity('sys/note').save$({ x: 1 })
    const nB = await mB0.entity('sys/note').save$({ x: 2 })
    const nC = await mC0.entity('sys/note').save$({ x: 3 })
    expect(nA).toMatchObject({ owner_id: 'u0', org_id: 'A' })

    // member reads its own row; admin reads across owners in the same org.
    expect(await mA0.entity('sys/note').load$(nA.id)).toMatchObject({ id: nA.id })
    expect(await oA.entity('sys/note').load$(nA.id))
      .toMatchObject({ id: nA.id, owner_id: 'u0' })

    // denials: other member (same org), other org's member, other org's admin.
    expect(await mA1.entity('sys/note').load$(nA.id)).toEqual(null)
    expect(await mB0.entity('sys/note').load$(nA.id)).toEqual(null)
    expect(await mC0.entity('sys/note').load$(nA.id)).toEqual(null)
    expect(await oB.entity('sys/note').load$(nA.id)).toEqual(null)

    // lists stay within the caller's org / ownership.
    const listOA = await oA.entity('sys/note').list$()
    expect(listOA.every((r) => r.org_id === 'A')).toBe(true)
    expect(listOA.find((r) => r.id === nB.id || r.id === nC.id)).toBeUndefined()
    expect((await mA1.entity('sys/note').list$()).find((r) => r.id === nA.id))
      .toBeUndefined()
  })


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
    expect(note).toMatchObject({ owner_id: 'g0', org_id: 'A' })

    // manager reads across owners in its org, still bounded by org_id.
    expect(await gA.entity('sys/note').load$(note.id)).toMatchObject({ id: note.id })
    expect(await gB.entity('sys/note').load$(note.id)).toEqual(null)

    // member and admin are not declared, so they get no preset: denied.
    for (const actor of [mA, oA]) {
      expect(await actor.entity('sys/note').load$(note.id)).toEqual(null)
      await expect(actor.entity('sys/note').save$({ x: 2 }))
        .rejects.toMatchObject({ code: 'role-entity-not-allowed' })
    }
  })


  // All custom: caller declares every role (member and admin included), so no
  // default is injected. Distinct grants, org scope and bad actors validated.
  test('all-custom-roles', async () => {
    const s0 = await build({
      member: { grants: [{ entity: 'sys/ticket' }] },
      support: { scope: 'org_id', grants: [{ entity: 'sys/ticket' }] },
      admin: { scope: 'org_id', grants: [{ entity: 'sys/billing' }] }
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
    expect(bill).toMatchObject({ owner_id: 'o0', org_id: 'A' })
    expect(await sA.entity('sys/ticket').load$(tA.id)).toMatchObject({ id: tA.id })
    expect(await oA.entity('sys/ticket').load$(tA.id)).toMatchObject({ id: tA.id })

    // denials by ownership / org.
    expect(await mA1.entity('sys/ticket').load$(tA.id)).toEqual(null)
    expect(await sB.entity('sys/ticket').load$(tA.id)).toEqual(null)
    expect(await sA.entity('sys/ticket').load$(tC.id)).toEqual(null)

    // bad actor: member and support cannot reach the admin-only billing entity.
    await expect(mA0.entity('sys/billing').save$({ amount: 1 }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })
    await expect(sA.entity('sys/billing').save$({ amount: 1 }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })

    // bad actor: an entity granted to no role is denied for everyone.
    for (const actor of [mA0, sA, oA]) {
      expect(await actor.entity('sys/secret').load$('any-id')).toEqual(null)
      await expect(actor.entity('sys/secret').save$({ z: 1 }))
        .rejects.toMatchObject({ code: 'role-entity-not-allowed' })
    }

    const listSA = await sA.entity('sys/ticket').list$()
    expect(listSA.every((r) => r.org_id === 'A')).toBe(true)
  })
})
