/* Copyright (c) 2018-2026 voxgig and other contributors, MIT License */
'use strict'

const { describe, test } = require('node:test')
const { expect } = require('@hapi/code')

const Seneca = require('seneca')

const build_roles = require('../dist/build_roles').build_roles

// Exercise build_roles with the real seneca deps, no full plugin/entity stack.
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
    expect(grantFor(compiled, 'editor', 'sys', 'doc')).to.equal(ALL)
    expect(grantFor(compiled, 'editor', 'sys', 'note')).to.equal(null)

    // member has only its own grant.
    expect(grantFor(compiled, 'member', 'sys', 'note')).to.equal(ALL)
    expect(grantFor(compiled, 'member', 'sys', 'doc')).to.equal(null)
  })


  test('explicit-inherits-member-gets-member-grants', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { inherits: ['member'], grants: [{ entity: 'sys/doc' }] }
    })

    expect(grantFor(compiled, 'editor', 'sys', 'doc')).to.equal(ALL)
    expect(grantFor(compiled, 'editor', 'sys', 'note')).to.equal(ALL)
  })


  test('multi-parent-unions-grants', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { inherits: ['member'], grants: [{ entity: 'sys/doc' }] },
      billing: { inherits: ['member'], grants: [{ entity: 'sys/invoice' }] },
      super: { inherits: ['editor', 'billing'], grants: [{ entity: 'sys/audit' }] }
    })

    // super = own + editor(+member) + billing(+member): full union, no dupes.
    expect(grantFor(compiled, 'super', 'sys', 'audit')).to.equal(ALL)
    expect(grantFor(compiled, 'super', 'sys', 'doc')).to.equal(ALL)
    expect(grantFor(compiled, 'super', 'sys', 'invoice')).to.equal(ALL)
    expect(grantFor(compiled, 'super', 'sys', 'note')).to.equal(ALL)
  })


  test('specific-grant-unions-inherited-wildcard-ops', () => {
    const compiled = compile({
      member: { grants: [{ entity: '*', ops: ['load$'] }] },
      editor: { inherits: ['member'], grants: [{ entity: 'sys/doc', ops: ['save$'] }] }
    })

    // specific sys/doc grant unions the inherited wildcard, not shadows it.
    expect(grantFor(compiled, 'editor', 'sys', 'doc')).to.equal(['load', 'save'])
    expect(grantFor(compiled, 'editor', 'sys', 'other')).to.equal(['load'])
  })


  test('base-wildcard-unions-into-specific-entity', () => {
    const compiled = compile({
      reader: {
        grants: [
          { entity: 'sys/*', ops: ['list$', 'load$'] },
          { entity: 'sys/doc', ops: ['save$'] }
        ]
      }
    })

    // sys/doc folds in the broader sys/* ops; other sys entities keep them too.
    expect(grantFor(compiled, 'reader', 'sys', 'doc')).to.equal(['list', 'load', 'save'])
    expect(grantFor(compiled, 'reader', 'sys', 'note')).to.equal(['list', 'load'])
  })


  test('narrower-wildcard-spec-wins-over-broader', () => {
    const compiled = compile({
      reader: {
        grants: [
          { entity: '*', ops: ['load$'], spec: { read: { owner_id: true } } },
          { entity: 'sys/*', ops: ['load$'], spec: { read: { owner_id: false } } },
          { entity: 'sys/doc', ops: ['save$'] }
        ]
      }
    })

    // sys/doc is covered by both '*' and 'sys/*'; the narrower sys/* spec wins.
    const g = compiled.reader.find({ base: 'sys', name: 'doc' })
    expect(g.spec.read.owner_id).to.equal(false)
  })


  test('independent-branches-do-not-cross-contaminate', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { grants: [{ entity: 'sys/doc' }] },
      auditor: { grants: [{ entity: 'sys/log', ops: ['list$', 'load$'] }] }
    })

    // editor and auditor both inherit only member, never each other.
    expect(grantFor(compiled, 'editor', 'sys', 'log')).to.equal(null)
    expect(grantFor(compiled, 'auditor', 'sys', 'doc')).to.equal(null)

    // and restricting one does not widen the other
    expect(grantFor(compiled, 'auditor', 'sys', 'log')).to.equal(['list', 'load'])
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
    expect(compiled.opener.find({ base: 'sys', name: 'doc' }).spec.read.owner_id).to.equal(false)
    expect(compiled.member.find({ base: 'sys', name: 'doc' }).spec.read.owner_id).to.equal(true)
  })


  test('scope-disables-relaxed-axis-per-role', () => {
    const compiled = compile({
      member: { grants: [{ entity: 'sys/note' }] },
      admin: { scope: '*', inherits: ['member'], grants: [{ entity: '*' }] }
    })

    // admin scope relaxes owner_id on inherited grants too...
    const adminNote = compiled.admin.find({ base: 'sys', name: 'note' })
    expect(adminNote.spec.read.owner_id).to.equal(false)
    expect(adminNote.spec.write.owner_id).to.equal(false)

    // member (no scope) keeps enforcing it.
    const memberNote = compiled.member.find({ base: 'sys', name: 'note' })
    expect(memberNote.spec.read?.owner_id).to.not.equal(false)
  })


  test('scope-naming-unknown-axis-throws', () => {
    expect(() => compile({
      member: { grants: [{ entity: 'sys/note' }] },
      admin: { scope: 'nope', grants: [{ entity: '*' }] }
    })).to.throw(/role-scope-unknown/)
  })


  test('scope-retains-tenant-axis', () => {
    const compiled = compile(
      { admin: { scope: 'org_id', grants: [{ entity: '*' }] } },
      ['owner_id', 'org_id']
    )

    // scope:'org_id' relaxes the owner axis but keeps the tenant axis enforced.
    const g = compiled.admin.find({ base: 'sys', name: 'note' })
    expect(g.spec.read.owner_id).to.equal(false)
    expect(g.spec.write.owner_id).to.equal(false)
    expect(g.spec.read.org_id).to.not.equal(false)
    expect(g.spec.write.org_id).to.not.equal(false)
  })


  test('cycle-in-inherit-graph-throws', () => {
    expect(() => compile({
      member: { grants: [{ entity: 'sys/note' }] },
      a: { inherits: ['b'], grants: [] },
      b: { inherits: ['a'], grants: [] }
    })).to.throw(/role-inherit-cycle/)
  })


  test('unknown-parent-throws', () => {
    expect(() => compile({
      member: { grants: [{ entity: 'sys/note' }] },
      editor: { inherits: ['ghost'], grants: [{ entity: 'sys/doc' }] }
    })).to.throw(/role-inherit-unknown/)
  })
})
