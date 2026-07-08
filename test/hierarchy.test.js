/* Copyright (c) 2018-2023 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

// A single owner instance scopes by BOTH owner_id and org_id: list `fields`
// with the owner field first (the per-user axis) and the org field after (the
// tenant axis). Roles are declared junior -> senior; a senior role inherits
// every junior role's entity grants. `scope:'all'` stops enforcing the owner
// field (reads across users) but the org field still applies, so a role never
// leaves its tenant.
//
//   member -> own rows,  sys/note
//   lead   -> whole org, sys/report (+ inherited sys/note)
//   admin  -> whole org, sys/setting (+ inherited sys/report, sys/note)

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
          member: { scope: 'own', entities: ['sys/note'] },
          lead: { scope: 'all', entities: ['sys/report'] },
          admin: { scope: 'all', entities: ['sys/setting'] }
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
          member: { scope: 'own', entities: ['sys/note'] },
          admin: { scope: 'all', entities: ['sys/report'] }
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

    // the senior admin (scope:'all') sees it
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
          member: { scope: 'own', entities: ['sys/note'] },
          admin: { scope: 'all', entities: ['sys/report'] }
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
    // enforced even for a scope:'all' role)
    expect(await adminA.entity('sys/note').load$(noteA.id))
      .toMatchObject({ id: noteA.id, org_id: 'A' })
    expect(await adminB.entity('sys/note').load$(noteA.id)).toEqual(null)

    // list is likewise bounded to the caller's org
    const listA = await adminA.entity('sys/note').list$()
    expect(listA.every((r) => r.org_id === 'A')).toBe(true)
    expect(listA.find((r) => r.id === noteB.id)).toBeUndefined()
  })
})
