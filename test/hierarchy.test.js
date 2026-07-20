/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

// Roles inherit via explicit `inherits` edges (a DAG): a role's effective
// grants are the union of every role it inherits plus its own. An org-scoped
// role stops enforcing the owner field but still keeps the tenant field.
//
//   member -> own rows,  sys/note
//   lead   -> whole org, sys/report  (inherits member: + sys/note)
//   admin  -> whole org, sys/setting (inherits lead:   + sys/report, sys/note)

describe('hierarchy', () => {

  test('senior-role-inherits-junior-permissions', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'org_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/note' }] },
          lead: { scope: 'org_id', inherits: ['member'], grants: [{ entity: 'sys/report' }] },
          admin: { scope: 'org_id', inherits: ['lead'], grants: [{ entity: 'sys/setting' }] }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', org_id: 'A', role: 'member' } }
    })
    const lead = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', org_id: 'A', role: 'lead' } }
    })
    const admin = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'o0', org_id: 'A', role: 'admin' } }
    })

    // member: only its own entity, nothing from senior roles.
    const note = await member.entity('sys/note').save$({ x: 1 })
    expect(note).toMatchObject({ x: 1, owner_id: 'u0', org_id: 'A' })
    await expect(member.entity('sys/report').save$({ x: 1 }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })

    // lead: own (report) + inherited junior (note); denied the senior entity.
    const report = await lead.entity('sys/report').save$({ x: 2 })
    expect(report).toMatchObject({ owner_id: 'a0', org_id: 'A' })
    const leadNote = await lead.entity('sys/note').save$({ x: 3 })
    expect(leadNote).toMatchObject({ owner_id: 'a0', org_id: 'A' })
    await expect(lead.entity('sys/setting').save$({ x: 1 }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })

    // admin: own (setting) + everything inherited from below.
    const setting = await admin.entity('sys/setting').save$({ x: 4 })
    expect(setting).toMatchObject({ owner_id: 'o0', org_id: 'A' })
    const adminReport = await admin.entity('sys/report').save$({ x: 5 })
    expect(adminReport).toMatchObject({ org_id: 'A' })
    const adminNote = await admin.entity('sys/note').save$({ x: 6 })
    expect(adminNote).toMatchObject({ owner_id: 'o0', org_id: 'A', x: 6 })
  })


  test('senior-sees-junior-rows-within-org', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'org_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/note' }] },
          admin: { scope: 'org_id', inherits: ['member'], grants: [{ entity: 'sys/report' }] }
        }
      })
      .ready()

    const member0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', org_id: 'A', role: 'member' } }
    })
    const member1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u1', org_id: 'A', role: 'member' } }
    })
    const admin = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', org_id: 'A', role: 'admin' } }
    })

    const note = await member0.entity('sys/note').save$({ x: 1 })

    // a peer member (same level) cannot see another member's row
    expect(await member1.entity('sys/note').load$(note.id)).toEqual(null)

    // the senior admin (org role) sees it
    expect(await admin.entity('sys/note').load$(note.id))
      .toMatchObject({ id: note.id, owner_id: 'u0', org_id: 'A' })
  })


  test('org-scope-isolates-tenants', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'org_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/note' }] },
          admin: { scope: 'org_id', inherits: ['member'], grants: [{ entity: 'sys/report' }] }
        }
      })
      .ready()

    const memberA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', org_id: 'A', role: 'member' } }
    })
    const memberB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'v0', org_id: 'B', role: 'member' } }
    })
    const adminA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', org_id: 'A', role: 'admin' } }
    })
    const adminB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'b0', org_id: 'B', role: 'admin' } }
    })

    const noteA = await memberA.entity('sys/note').save$({ x: 1 })
    const noteB = await memberB.entity('sys/note').save$({ x: 2 })

    // admin sees its own org's row, but not the other org's (org_id stays
    // enforced even for a org role role)
    expect(await adminA.entity('sys/note').load$(noteA.id))
      .toMatchObject({ id: noteA.id, org_id: 'A' })
    expect(await adminB.entity('sys/note').load$(noteA.id)).toEqual(null)

    // list is likewise bounded to the caller's org
    const listA = await adminA.entity('sys/note').list$()
    expect(listA.every((r) => r.org_id === 'A')).toBe(true)
    expect(listA.find((r) => r.id === noteB.id)).toBeUndefined()
  })
})
