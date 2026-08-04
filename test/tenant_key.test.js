/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const { describe, test } = require('node:test')
const { expect } = require('@hapi/code')
const { LOG, partial } = require('./helper')

const Seneca = require('seneca')
const Plugin = require('..')

// The tenant axis is not hardcoded to `org_id`: it is any field declared after
// the first in `fields`. Here the tenant key is `tenant_id`, and scoping must
// behave exactly as with `org_id`.

describe('tenant-key', () => {

  test('custom-tenant-key-isolates-tenants', async () => {
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'tenant_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: 'sys/note' }] },
          admin: { scope: 'tenant_id', grants: [{ entity: 'sys/note' }] }
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
    partial(noteA, { x: 1, owner_id: 'u0', tenant_id: 'A' })
    expect(noteA.org_id).to.equal(undefined)

    const noteB = await memberB.entity('sys/note').save$({ x: 2 })

    // scope:'tenant_id' relaxes only the owner axis: admin sees a peer's row
    // within its own tenant, but the custom tenant axis still bounds it.
    partial(await adminA.entity('sys/note').load$(noteA.id), { id: noteA.id, owner_id: 'u0', tenant_id: 'A' })
    expect(await adminA.entity('sys/note').load$(noteB.id)).to.equal(null)

    const listA = await adminA.entity('sys/note').list$()
    expect(listA.every((r) => r.tenant_id === 'A')).to.equal(true)
    expect(listA.find((r) => r.id === noteB.id)).to.equal(undefined)
  })


  test('default-preset-roles-bound-to-custom-tenant-key', async () => {
    // No roles declared: built-in presets apply, but the tenant axis is tenant_id.
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
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
    const note = await memberA.entity('qux/zed').save$({ x: 1 })
    partial(note, { owner_id: 'u0', tenant_id: 'A' })
    expect(note.org_id).to.equal(undefined)

    // owner + tenant axes enforced against the custom key
    expect(await memberB.entity('qux/zed').load$(note.id)).to.equal(null)

    // admin reads across users within its tenant, never crossing tenant_id
    partial(await adminA.entity('qux/zed').load$(note.id), { id: note.id, tenant_id: 'A' })
    expect(await adminB.entity('qux/zed').load$(note.id)).to.equal(null)
  })


  test('custom-label-roles-bound-to-custom-tenant-key', async () => {
    // Custom labels with a declared member baseline: `bar` inherits member's
    // wildcard grant. Tenant axis is tenant_id, so baz scopes to it.
    const s0 = await Seneca({ legacy: false })
      .test(LOG)
      .use('promisify')
      .use('entity')
      .use(Plugin, {
        fields: ['owner_id', 'tenant_id'],
        annotate: ['sys:entity'],
        rolesys: true,
        roles: {
          member: { grants: [{ entity: '*' }] },
          bar: { inherits: ['member'], grants: [{ entity: 'foo/doc' }] },
          baz: { scope: 'tenant_id', grants: [{ entity: '*' }] }
        }
      })
      .ready()

    const barA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', tenant_id: 'A', role: 'bar' } }
    })
    const bazA = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'c0', tenant_id: 'A', role: 'baz' } }
    })
    const bazB = s0.delegate(null, {
      custom: { sysowner: { owner_id: 'd0', tenant_id: 'B', role: 'baz' } }
    })

    // bar: own grant + explicit member inheritance, tenant-bound
    const doc = await barA.entity('foo/doc').save$({ x: 1 })
    partial(doc, { owner_id: 'u0', tenant_id: 'A' })
    const misc = await barA.entity('qux/zed').save$({ x: 2 })
    partial(misc, { owner_id: 'u0', tenant_id: 'A' })

    // baz (scope:'tenant_id', wildcard): reads across users in its tenant only
    partial(await bazA.entity('foo/doc').load$(doc.id), { id: doc.id, tenant_id: 'A' })
    // never crosses the custom tenant axis
    expect(await bazB.entity('foo/doc').load$(doc.id)).to.equal(null)
  })
})
