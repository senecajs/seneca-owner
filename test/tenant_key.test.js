/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

// The tenant axis is not hardcoded to `org_id`: it is any field declared after
// the first in `fields`. Here the tenant key is `tenant_id`. Ownership and role
// scoping must behave exactly as with `org_id` — the plugin reads the axis names
// from `fields`, never from a literal.

describe('tenant-key', () => {

  test('custom-tenant-key-isolates-tenants', async () => {
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'tenant_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/note' }] },
          admin: { scope: 'org', grants: [{ entity: 'sys/note' }] }
        }
      })
      .ready()

    const memberA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', tenant_id: 'A', role: 'member' } }
    })
    const memberB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'v0', tenant_id: 'B', role: 'member' } }
    })
    const adminA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', tenant_id: 'A', role: 'admin' } }
    })

    // save stamps the custom tenant field, not org_id
    const noteA = await memberA.entity('sys/note').save$({ x: 1 })
    expect(noteA).toMatchObject({ x: 1, owner_id: 'u0', tenant_id: 'A' })
    expect(noteA.org_id).toBeUndefined()

    const noteB = await memberB.entity('sys/note').save$({ x: 2 })

    // scope:'org' relaxes only the owner axis: admin sees a peer's row within
    // its own tenant, but the custom tenant axis still bounds it.
    expect(await adminA.entity('sys/note').load$(noteA.id))
      .toMatchObject({ id: noteA.id, owner_id: 'u0', tenant_id: 'A' })
    expect(await adminA.entity('sys/note').load$(noteB.id)).toEqual(null)

    const listA = await adminA.entity('sys/note').list$()
    expect(listA.every((r) => r.tenant_id === 'A')).toBe(true)
    expect(listA.find((r) => r.id === noteB.id)).toBeUndefined()
  })


  test('default-preset-roles-bound-to-custom-tenant-key', async () => {
    // No roles declared: built-in presets apply, but the tenant axis is tenant_id.
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'tenant_id'],
        annotate: ['sys:entity'],
        rolesys: true
      })
      .ready()

    const memberA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', tenant_id: 'A' } }
    })
    const memberB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'v0', tenant_id: 'B' } }
    })
    const adminA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'a0', tenant_id: 'A', role: 'admin' } }
    })
    const adminB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'b0', tenant_id: 'B', role: 'admin' } }
    })

    // default member is wildcard: own rows on any entity, stamped with tenant_id
    const note = await memberA.entity('random/thing').save$({ x: 1 })
    expect(note).toMatchObject({ owner_id: 'u0', tenant_id: 'A' })
    expect(note.org_id).toBeUndefined()

    // owner + tenant axes enforced against the custom key
    expect(await memberB.entity('random/thing').load$(note.id)).toEqual(null)

    // admin reads across users within its tenant, never crossing tenant_id
    expect(await adminA.entity('random/thing').load$(note.id))
      .toMatchObject({ id: note.id, tenant_id: 'A' })
    expect(await adminB.entity('random/thing').load$(note.id)).toEqual(null)
  })


  test('custom-label-roles-bound-to-custom-tenant-key', async () => {
    // No member/admin labels declared; the member preset is still injected, so
    // scientist inherits the wildcard baseline. Tenant axis is tenant_id.
    const s0 = await Seneca({ legacy: false })
      .test()
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'tenant_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          scientist: { grants: [{ entity: 'personal/research' }] },
          captain: { scope: 'org', grants: [{ entity: '*' }] }
        }
      })
      .ready()

    const sciA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', tenant_id: 'A', role: 'scientist' } }
    })
    const captainA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'c0', tenant_id: 'A', role: 'captain' } }
    })
    const captainB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'd0', tenant_id: 'B', role: 'captain' } }
    })

    // scientist: own grant + inherited wildcard member baseline, tenant-bound
    const research = await sciA.entity('personal/research').save$({ x: 1 })
    expect(research).toMatchObject({ owner_id: 'u0', tenant_id: 'A' })
    const misc = await sciA.entity('random/thing').save$({ x: 2 })
    expect(misc).toMatchObject({ owner_id: 'u0', tenant_id: 'A' })

    // captain (scope:'org', wildcard): reads across users in its tenant only
    expect(await captainA.entity('personal/research').load$(research.id))
      .toMatchObject({ id: research.id, tenant_id: 'A' })
    // never crosses the custom tenant axis
    expect(await captainB.entity('personal/research').load$(research.id)).toEqual(null)
  })
})
