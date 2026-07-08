/* Copyright (c) 2018-2023 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

// Focused permission scenarios on top of the role layer:
//   1. Permissive convention (no entities declared) still isolates by owner/org.
//   2. Several roles with distinct grants; a bad actor never reaches an entity
//      it was not granted, regardless of the operation.

describe('permission', () => {

  // Nothing declared per role => full entity access by convention, yet the
  // owner_id + org_id scoping must still isolate every principal's data.
  test('permissive-convention-still-isolates-owner-and-org', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'org_id'],
        annotate: ['sys:entity'],
        roles: {
          member: { scope: 'own' }
        }
      })
      .ready()

    // Two tenants (A, B); two owners inside A.
    const a0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', org_id: 'A', role: 'member' } }
    })
    const a1 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a1', org_id: 'A', role: 'member' } }
    })
    const b0 = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'b0', org_id: 'B', role: 'member' } }
    })

    // Happy path: full access to any entity, each stamped with the caller.
    const noteA0 = await a0.entity('sys/note').save$({ x: 1 })
    const secretA0 = await a0.entity('sys/secret').save$({ x: 2 })
    expect(noteA0).toMatchObject({ owner_id: 'a0', org_id: 'A' })
    expect(secretA0).toMatchObject({ owner_id: 'a0', org_id: 'A' })

    const noteB0 = await b0.entity('sys/note').save$({ x: 3 })
    expect(noteB0).toMatchObject({ owner_id: 'b0', org_id: 'B' })

    // Owner reads its own rows.
    expect(await a0.entity('sys/note').load$(noteA0.id))
      .toMatchObject({ id: noteA0.id, owner_id: 'a0' })

    // Same tenant, different owner => denied.
    expect(await a1.entity('sys/note').load$(noteA0.id)).toEqual(null)
    expect(await a1.entity('sys/secret').load$(secretA0.id)).toEqual(null)

    // Different tenant => denied both ways.
    expect(await b0.entity('sys/note').load$(noteA0.id)).toEqual(null)
    expect(await a0.entity('sys/note').load$(noteB0.id)).toEqual(null)

    // Lists never leak across the owner/org boundary.
    const listA1 = await a1.entity('sys/note').list$()
    expect(listA1.find((r) => r.id === noteA0.id)).toBeUndefined()
    const listB0 = await b0.entity('sys/note').list$()
    expect(listB0.every((r) => r.org_id === 'B')).toBe(true)
  })


  // Three roles, distinct grants, junior -> senior:
  //   viewer -> read-only sys/doc
  //   editor -> read+write sys/doc (inherits viewer)
  //   admin  -> read+write sys/audit (inherits sys/doc)
  // A caller must never reach an entity/op outside its (inherited) grant.
  test('multi-role-grants-and-bad-actor-denied', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'org_id'],
        annotate: ['sys:entity'],
        roles: {
          // member declared explicitly to restrict the baseline (read-only doc)
          // instead of the full-access convention default.
          member: { scope: 'own', entities: { 'sys/doc': { read: true } } },
          editor: { scope: 'own', entities: { 'sys/doc': true } },
          admin: { scope: 'all', entities: { 'sys/audit': true } }
        }
      })
      .ready()

    const member = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', org_id: 'A', role: 'member' } }
    })
    const editor = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'e0', org_id: 'A', role: 'editor' } }
    })
    const admin = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'm0', org_id: 'A', role: 'admin' } }
    })

    // Happy path: editor writes a doc, reads it back.
    const doc = await editor.entity('sys/doc').save$({ t: 'draft' })
    expect(doc).toMatchObject({ owner_id: 'e0', org_id: 'A' })
    expect(await editor.entity('sys/doc').load$(doc.id))
      .toMatchObject({ id: doc.id, owner_id: 'e0' })

    // Happy path: admin writes audit, and (scope:'all' + inherited doc) reads
    // the editor's doc within the same org.
    const audit = await admin.entity('sys/audit').save$({ t: 'log' })
    expect(audit).toMatchObject({ owner_id: 'm0', org_id: 'A' })
    expect(await admin.entity('sys/doc').load$(doc.id))
      .toMatchObject({ id: doc.id, owner_id: 'e0' })

    // member: read granted on its own doc, but write denied.
    const own = await s0.entity('sys/doc').save$({ owner_id: 'u0', org_id: 'A', t: 'x' })
    expect(await member.entity('sys/doc').load$(own.id))
      .toMatchObject({ id: own.id, owner_id: 'u0' })
    await expect(member.entity('sys/doc').save$({ t: 'y' }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })

    // Bad actor: editor cannot reach the senior-only sys/audit entity.
    expect(await editor.entity('sys/audit').load$(audit.id)).toEqual(null)
    expect(await editor.entity('sys/audit').list$()).toEqual([])
    await expect(editor.entity('sys/audit').save$({ t: 'z' }))
      .rejects.toMatchObject({ code: 'role-entity-not-allowed' })

    // Bad actor: an entity granted to no role is denied for everyone.
    for (const actor of [member, editor, admin]) {
      expect(await actor.entity('sys/secret').load$('any-id')).toEqual(null)
      expect(await actor.entity('sys/secret').list$()).toEqual([])
      await expect(actor.entity('sys/secret').save$({ t: 'q' }))
        .rejects.toMatchObject({ code: 'role-entity-not-allowed' })
    }
  })
})
