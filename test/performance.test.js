/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')
const Plugin = require('..')

// Understand how the role layer affects performance on large user tables.
// The role gate is a per-op Patrun.find, independent of row count, so its cost
// should stay roughly constant relative to the underlying store scan as the
// table grows. These tests seed many owners/rows via a factory and compare
// role-enforced access against plain ownership.

function makeSeneca(opts) {
  return Seneca({ legacy: false })
    .test()
    .use('promisify')
    .use('entity')
    .use(Plugin, opts)
    .ready()
}

// Factory: OWNERS distinct owners, ROWS rows each, on sys/doc. Seeded via the
// root instance (no owner => plain, unscoped save) with an explicit owner_id.
async function seed(s0, owners, rowsPerOwner) {
  const saves = []

  for (let o = 0; o < owners; o++) {
    const owner_id = 'u' + o

    for (let r = 0; r < rowsPerOwner; r++) {
      saves.push(s0.entity('sys/doc').save$({ owner_id, i: r }))
    }
  }

  await Promise.all(saves)
}

// A non-trivial inherit DAG with a wildcard baseline, so enforcement exercises
// the unioned effective-permission lookup, not a single flat grant.
const roles = {
  base: { grants: [{ entity: '*', ops: ['load$'] }] },
  member: { inherits: ['base'], grants: [{ entity: 'sys/doc', ops: ['list$', 'load$'] }] },
  editor: { inherits: ['member'], grants: [{ entity: 'sys/doc', ops: ['save$'] }] },
  admin: { scope: '*', inherits: ['editor'], grants: [{ entity: '*' }] }
}

describe('performance', () => {
  jest.setTimeout(120000)

  test('role-gate-overhead-stays-bounded-on-large-table', async () => {
    const owners = 100
    const rowsPerOwner = 20 // 2000 rows total

    const withRoles = await makeSeneca({
      fields: ['owner_id'], annotate: ['sys:entity'], rolesys: true, roles
    })

    const plain = await makeSeneca({
      fields: ['owner_id'], annotate: ['sys:entity']
    })

    await seed(withRoles, owners, rowsPerOwner)
    await seed(plain, owners, rowsPerOwner)

    const member = withRoles.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    const plainU = plain.delegate(null, {
      custom: { sysowner: { owner_id: 'u0' } }
    })

    // correctness under load: role-scoped list still returns own rows only
    const own = await member.entity('sys/doc').list$()
    expect(own.length).toBe(rowsPerOwner)
    expect(own.every((r) => r.owner_id === 'u0')).toBe(true)

    const opCount = 200

    const roleStartMs = Date.now()
    for (let op = 0; op < opCount; op++) {
      await member.entity('sys/doc').list$()
    }

    const roleElapsedMs = Date.now() - roleStartMs
    const plainStartMs = Date.now()

    for (let op = 0; op < opCount; op++) {
      await plainU.entity('sys/doc').list$()
    }

    const plainElapsedMs = Date.now() - plainStartMs

    // Role enforcement adds a constant-per-op Patrun lookup, so overhead over
    // plain ownership stays within a small multiple regardless of table size.
    const overheadRatio = roleElapsedMs / Math.max(plainElapsedMs, 1)
    const maxOverheadRatio = 3 // role-enforced list$ at most 3x plain ownership

    // eslint-disable-next-line no-console
    console.log(
      `perf list$: role=${roleElapsedMs}ms plain=${plainElapsedMs}ms overhead=${overheadRatio.toFixed(2)}x` +
      ` (${owners * rowsPerOwner} rows, ${opCount} ops)`
    )

    expect(overheadRatio).toBeLessThan(maxOverheadRatio)
  })


  test('point-load-under-role-gate-is-fast-on-large-table', async () => {
    const owners = 100
    const rowsPerOwner = 20

    const withRoles = await makeSeneca({
      fields: ['owner_id'], annotate: ['sys:entity'], rolesys: true, roles
    })

    await seed(withRoles, owners, rowsPerOwner)

    const member = withRoles.delegate(null, {
      custom: { sysowner: { owner_id: 'u0', role: 'member' } }
    })

    // seed via root (no owner => plain save); member grant is read-only
    const seedRow = await withRoles.entity('sys/doc').save$({ owner_id: 'u0', i: 999 })

    const opCount = 500
    const startMs = Date.now()

    for (let op = 0; op < opCount; op++) {
      const row = await member.entity('sys/doc').load$(seedRow.id)
      expect(row.owner_id).toBe('u0')
    }

    const msPerOp = (Date.now() - startMs) / opCount
    const maxMsPerOp = 20 // point load ceiling, independent of table size

    console.log(`perf load$: ${msPerOp.toFixed(3)}ms/op (${owners * rowsPerOwner} rows, ${opCount} ops)`)

    // generous ceiling: point loads should not degrade with table size
    expect(msPerOp).toBeLessThan(maxMsPerOp)
  })
})
