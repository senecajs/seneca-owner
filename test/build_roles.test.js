/* Copyright (c) 2020 voxgig and other contributors, MIT License */
'use strict'

const Seneca = require('seneca')

const build_roles = require('../dist/build_roles').build_roles

// A real seneca instance supplies the injected deps (deepextend, Patrun,
// error), so the module is exercised exactly as Owner.ts wires it, but without
// booting the full plugin / entity stack.
const s0 = Seneca({ legacy: false }).test()

const deps = {
  deep: s0.util.deepextend,
  Patrun: s0.util.Patrun,
  error: s0.error.bind(s0)
}

function compile(roles, fields, ownerfield) {
  return build_roles(
    { roles, fields: fields || ['owner_id'], ownerfield: ownerfield || 'owner_id' },
    deps
  )
}

// Which ops a role is granted on an entity: null if no matching grant.
function grantFor(compiled, role, base, name) {
  const g = compiled[role] && compiled[role].find({ base, name })
  return g ? [...g.ops].sort() : null
}

const ALL = ['list', 'load', 'remove', 'save']

describe('build_roles', () => {

  test('role-without-inherits-gets-only-own-grants', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { grants: [{ entity: 'sys/doc' }] }
    })

    // editor has no inherits: only its own grant, no member baseline.
    expect(grantFor(compiled, 'editor', 'sys', 'doc')).toEqual(ALL)
    expect(grantFor(compiled, 'editor', 'sys', 'note')).toEqual(null)

    // member has only its own grant.
    expect(grantFor(compiled, 'member', 'sys', 'note')).toEqual(ALL)
    expect(grantFor(compiled, 'member', 'sys', 'doc')).toEqual(null)
  })


  test('explicit-inherits-member-gets-member-grants', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { inherits: ['member'], grants: [{ entity: 'sys/doc' }] }
    })

    expect(grantFor(compiled, 'editor', 'sys', 'doc')).toEqual(ALL)
    expect(grantFor(compiled, 'editor', 'sys', 'note')).toEqual(ALL)
  })


  test('multi-parent-unions-grants', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { inherits: ['member'], grants: [{ entity: 'sys/doc' }] },
      billing: { inherits: ['member'], grants: [{ entity: 'sys/invoice' }] },
      super: { inherits: ['editor', 'billing'], grants: [{ entity: 'sys/audit' }] }
    })

    // super = own + editor(+member) + billing(+member): full union, no dupes.
    expect(grantFor(compiled, 'super', 'sys', 'audit')).toEqual(ALL)
    expect(grantFor(compiled, 'super', 'sys', 'doc')).toEqual(ALL)
    expect(grantFor(compiled, 'super', 'sys', 'invoice')).toEqual(ALL)
    expect(grantFor(compiled, 'super', 'sys', 'note')).toEqual(ALL)
  })


  test('independent-branches-do-not-cross-contaminate', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { grants: [{ entity: 'sys/doc' }] },
      auditor: { grants: [{ entity: 'sys/log', ops: ['list$', 'load$'] }] }
    })

    // editor and auditor both inherit only member, never each other.
    expect(grantFor(compiled, 'editor', 'sys', 'log')).toEqual(null)
    expect(grantFor(compiled, 'auditor', 'sys', 'doc')).toEqual(null)

    // and restricting one does not widen the other
    expect(grantFor(compiled, 'auditor', 'sys', 'log')).toEqual(['list', 'load'])
  })


  test('own-spec-wins-over-inherited', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/doc', spec: { read: { owner_id: true } } }] },
      opener: {
        inherits: ['member'],
        grants: [{ entity: 'sys/doc', spec: { read: { owner_id: false } } }]
      }
    })

    // own fragment applied last: opener relaxes the field member enforced.
    expect(compiled.opener.find({ base: 'sys', name: 'doc' }).spec.read.owner_id)
      .toBe(false)
    expect(compiled.member.find({ base: 'sys', name: 'doc' }).spec.read.owner_id)
      .toBe(true)
  })


  test('scope-disables-relaxed-axis-per-role', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      admin: { scope: '*', inherits: ['member'], grants: [{ entity: '*' }] }
    })

    // admin scope relaxes owner_id on inherited grants too...
    const adminNote = compiled.admin.find({ base: 'sys', name: 'note' })
    expect(adminNote.spec.read.owner_id).toBe(false)
    expect(adminNote.spec.write.owner_id).toBe(false)

    // ...but member (no scope) keeps enforcing it.
    const memberNote = compiled.member.find({ base: 'sys', name: 'note' })
    expect(memberNote.spec.read || {}).not.toHaveProperty('owner_id', false)
  })


  test('scope-naming-unknown-axis-throws', () => {
    expect(() => compile({
      member: { grants: [{ entity: 'sys/note' }] },
      admin: { scope: 'nope', grants: [{ entity: '*' }] }
    })).toThrow(/role-scope-unknown/)
  })


  test('scope-retains-tenant-axis', () => {
    const compiled = compile(
      { admin: { scope: 'org_id', grants: [{ entity: '*' }] } },
      ['owner_id', 'org_id']
    )

    // scope:'org_id' relaxes the owner axis but keeps the tenant axis enforced.
    const g = compiled.admin.find({ base: 'sys', name: 'note' })
    expect(g.spec.read.owner_id).toBe(false)
    expect(g.spec.write.owner_id).toBe(false)
    expect(g.spec.read).not.toHaveProperty('org_id', false)
  })


  test('cycle-in-inherit-graph-throws', () => {
    expect(() => compile({
      member: { grants: [{ entity: 'sys/note' }] },
      a: { inherits: ['b'], grants: [] },
      b: { inherits: ['a'], grants: [] }
    })).toThrow(/role-inherit-cycle/)
  })


  test('unknown-parent-throws', () => {
    expect(() => compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { inherits: ['ghost'], grants: [{ entity: 'sys/doc' }] }
    })).toThrow(/role-inherit-unknown/)
  })
})
