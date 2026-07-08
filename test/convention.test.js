/* Copyright (c) 2018-2023 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

// Convention over configuration for the role set itself. Two roles exist by
// default without being declared: member (own rows) and admin (whole tenant),
// both full read+write. Declared roles slot in junior -> senior between them:
//   member -> ...declared... -> admin
// Every scenario spans three tenants (A, B, C) to prove the org scope holds.

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


  // Partial: caller declares one custom role; member/admin defaults still apply,
  // the custom role sits between them (junior -> member, senior -> admin).
  test('partial-custom-role-between-defaults', async () => {
    const s0 = await build({
      // whole-org, full access by convention
      manager: { scope: 'org', grants: [{ entity: '*' }] }
    })

    const mA0 = as(s0, 'u0', 'A', 'member')
    const mA1 = as(s0, 'u1', 'A', 'member')
    const gA = as(s0, 'g0', 'A', 'manager')
    const gB = as(s0, 'g1', 'B', 'manager')
    const oA = as(s0, 'o0', 'A', 'admin')
    const mC0 = as(s0, 'w0', 'C', 'member')

    const nA = await mA0.entity('sys/note').save$({ x: 1 })
    const nC = await mC0.entity('sys/note').save$({ x: 2 })

    // manager (custom, org role) reads across owners in its own org; the
    // admin default is still present and sees it too.
    expect(await gA.entity('sys/note').load$(nA.id))
      .toMatchObject({ id: nA.id, owner_id: 'u0' })
    expect(await oA.entity('sys/note').load$(nA.id)).toMatchObject({ id: nA.id })

    // denials: peer member, manager in another org, manager reaching org C.
    expect(await mA1.entity('sys/note').load$(nA.id)).toEqual(null)
    expect(await gB.entity('sys/note').load$(nA.id)).toEqual(null)
    expect(await gA.entity('sys/note').load$(nC.id)).toEqual(null)

    const listGA = await gA.entity('sys/note').list$()
    expect(listGA.every((r) => r.org_id === 'A')).toBe(true)
  })


  // All custom: caller declares every role (member and admin included), so no
  // default is injected. Distinct grants, org scope and bad actors validated.
  test('all-custom-roles', async () => {
    const s0 = await build({
      member: { grants: [{ entity: 'sys/ticket' }] },
      support: { scope: 'org', grants: [{ entity: 'sys/ticket' }] },
      admin: { scope: 'org', grants: [{ entity: 'sys/billing' }] }
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
