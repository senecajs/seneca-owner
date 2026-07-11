/* Copyright (c) 2018-2020 Voxgig and other contributors, MIT License */

// Compile the role option into a map of role-name -> Patrun of
// entity-pattern -> { ops, spec }. Roles form a hierarchy expressed as an
// explicit DAG: each role may `inherit` other roles, and its effective grants
// are the union (transitive closure) of every inherited role plus its own.
// Unless a role declares `inherits`, it inherits `member`, so every role has
// the member baseline by default. `member` is the root and inherits nothing.

export type Grant = { entity: string; ops?: string[]; spec?: any }
export type Role = { scope?: string; inherits?: any; grants?: Grant[] }
export type Roles = { [name: string]: Role }

export type BuildRolesOpts = {
  roles: Roles
  fields: string[]
  ownerfield: string
}

export type BuildRolesDeps = {
  // seneca.util.deepextend: deep-clone/merge helper
  deep: (...args: any[]) => any
  // seneca.util.Patrun: pattern matcher constructor
  Patrun: () => any
  // seneca.error: build a coded Error for fail-fast init errors
  error: (code: string, details?: any) => Error
}

// A grant is a string entity pattern or { entity, ops?, spec? }. Normalize to
// { entity, ops:Set<cmd>, spec }. ops use seneca method names (list$ ...) so
// the config speaks the ORM's language; strip the $ to match msg.cmd.
function normalizeGrant(grant: any) {
  if ('string' === typeof grant) {
    grant = { entity: grant }
  }

  const allOps = ['list$', 'load$', 'save$', 'remove$']

  const ops = new Set(
    (grant.ops || allOps).map((op: string) => ('' + op).replace(/\$$/, ''))
  )

  return { entity: '' + grant.entity, ops, spec: grant.spec || {} }
}

// Deep-merge two grant lists into a superset keyed by entity: ops union, later
// spec fragment wins. `add` is applied over `base`, so callers pass the more
// senior list last (own grants after inherited ones). Returns fresh grant
// objects, so a memoized result can be safely reused by several callers.
function mergeGrantLists(deep: any, base: any[], add: any[]) {
  const byEntity: any = {}

  base.concat(add).forEach((grant: any) => {
    const prev = byEntity[grant.entity]

    if (!prev) {
      byEntity[grant.entity] = {
        entity: grant.entity,
        ops: new Set(grant.ops),
        spec: deep({}, grant.spec)
      }
    }

    else {
      grant.ops.forEach((op: any) => prev.ops.add(op))
      prev.spec = deep(prev.spec, grant.spec)
    }
  })

  return Object.values(byEntity)
}

// Entity pattern -> Patrun match key. '*' any, 'base/*' whole base, else exact.
function entityPat(entity: string) {
  if ('*' === entity) {
    return {}
  }

  const [base, name] = entity.split('/')
  return (null == name || '*' === name) ? { base } : { base, name }
}

// Fold scope:'org' into a spec fragment: disable the user-axis field so the
// role reads/writes across users, while the tenant axis stays enforced.
function buildGrantSpec(deep: any, opts: BuildRolesOpts, grantSpec: any, scopeOrg: boolean) {
  const spec = deep({}, grantSpec)

  if (!scopeOrg) {
    return spec
  }

  spec.read = spec.read || {}
  spec.write = spec.write || {}

  for (const field of (opts.fields || [])) {
    const parts = ('' + field).split(':')
    const entityField = null == parts[1] ? parts[0] : parts[1]

    if (entityField === opts.ownerfield) {
      spec.read[field] = false
      spec.write[field] = false
    }
  }

  return spec
}

// Resolve a role's inherit edges. Default: inherit `member` so every role has
// the member baseline. `member` is the root (inherits nothing). Explicit
// `inherits: []` / 'none' / null opts out; a string or array names parents.
function resolveInherits(name: string, role: Role) {
  if ('member' === name) {
    return []
  }

  const inh = role.inherits

  if (undefined === inh) {
    return ['member']
  }

  if (null == inh || 'none' === inh) {
    return []
  }

  return Array.isArray(inh) ? inh : [inh]
}

// Effective grants = transitive closure over inherit edges. Memoized DFS with
// three-colour marking: WHITE unvisited, GREY on the active stack (a re-entry
// is a cycle), BLACK done. Parents merged first, own grants last so the role's
// own spec fragments win on conflict.
const WHITE = 0, GREY = 1, BLACK = 2

function effectiveGrants(
  deep: any,
  error: BuildRolesDeps['error'],
  roles: Roles,
  memo: any,
  colour: any,
  name: string
): any[] {
  if (BLACK === colour[name]) {
    return memo[name]
  }

  if (GREY === colour[name]) {
    throw error('role-inherit-cycle', { role: name })
  }

  if (null == roles[name]) {
    throw error('role-inherit-unknown', { role: name })
  }

  colour[name] = GREY

  const role = roles[name] || {}

  let grants: any[] = []
  for (const parent of resolveInherits(name, role)) {
    grants = mergeGrantLists(
      deep, grants,
      effectiveGrants(deep, error, roles, memo, colour, parent)
    )
  }

  const own = (role.grants || []).map(normalizeGrant)
  grants = mergeGrantLists(deep, grants, own)

  colour[name] = BLACK
  return (memo[name] = grants)
}

export function build_roles(
  opts: BuildRolesOpts,
  deps: BuildRolesDeps
): { [name: string]: any } {
  const { deep, Patrun, error } = deps
  const roles = opts.roles || {}

  const memo: any = {}
  const colour: any = {}

  const compiled: any = {}

  Object.keys(roles).forEach((name: string) => {
    const role = roles[name] || {}

    // scope is role-level, not grant-level: scopeOrg here applies to ALL of
    // this role's effective grants (inherited + own). A single role cannot be
    // org-scoped for some entities but owner-scoped for others.
    const scopeOrg = 'org' === role.scope

    const grants = effectiveGrants(deep, error, roles, memo, colour, name)

    const patrun = Patrun()
    grants.forEach((grant: any) => {
      patrun.add(
        entityPat(grant.entity),
        { ops: grant.ops, spec: buildGrantSpec(deep, opts, grant.spec, scopeOrg) }
      )
    })

    compiled[name] = patrun
  })

  return compiled
}
