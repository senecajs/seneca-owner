/* Copyright (c) 2018-2026 Voxgig and other contributors, MIT License */

// Compile roles into a map of role-name -> Patrun of entity-pattern ->
// { ops, spec }. Roles form an inherit DAG; effective permissions are the
// transitive union of inherited roles plus own grants.

type Grant = { entity: string; ops?: string[]; spec?: any }
type Role = { scope?: string; inherits?: any; grants?: Grant[] }
type Roles = { [name: string]: Role }
type Permission = { entity: string; ops: Set<string>; spec: any }
type Memo = { [name: string]: Permission[] }
type RolePatrun = { find: (pat: { base?: string; name?: string }) => { ops: Set<string>; spec: any } | null }
export type CompiledRoles = { [name: string]: RolePatrun }

type BuildRolesOptions = {
  roles: Roles
  fields: string[]
  ownerfield: string
}

type BuildRolesUtils = {
  deep: (...args: any[]) => any
  Patrun: () => any
  error: (code: string, details?: any) => Error
}

function normalizeGrant(grant: any): Permission {
  if ('string' === typeof grant) {
    grant = { entity: grant }
  }

  const allOps = ['list$', 'load$', 'save$', 'remove$']

  // ops are seneca method names; strip the $ to match msg.cmd.
  const ops = new Set<string>(
    (grant.ops || allOps).map((op: string) => ('' + op).replace(/\$$/, ''))
  )

  return { entity: '' + grant.entity, ops, spec: grant.spec || {} }
}

// Union two permission lists keyed by entity: ops union, later spec wins.
function mergePermissions(deep: any, base: Permission[], add: Permission[]): Permission[] {
  const byEntity: { [entity: string]: Permission } = {}

  base.concat(add).forEach((perm: any) => {
    const prev = byEntity[perm.entity]

    if (!prev) {
      byEntity[perm.entity] = {
        entity: perm.entity,
        ops: new Set(perm.ops),
        spec: deep({}, perm.spec)
      }
    }

    else {
      perm.ops.forEach((op: any) => prev.ops.add(op))
      prev.spec = deep(prev.spec, perm.spec)
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

// Default roles when caller declares none. admin scopes to the tenant axis,
// or global ('*') when none is declared.
export function default_roles(tenantAxis: string | undefined): Roles {
  return {
    member: { grants: [{ entity: '*' }] },
    admin: { scope: tenantAxis || '*', grants: [{ entity: '*' }] }
  }
}

// Enforced axis name of a `fields` entry: entity-side of `owner:entity`.
export function axisName(field: string) {
  const parts = ('' + field).split(':')
  return null == parts[1] ? parts[0] : parts[1]
}

// Scope -> cutoff index: axes before it (more specific) are relaxed, the scope
// axis and broader stay enforced. null: relax none. '*': relax all (global).
function scopeCutoff(options: BuildRolesOptions, error: BuildRolesUtils['error'], scope: any): number {
  const fields = options.fields || []

  if (null == scope) {
    return 0
  }

  if ('*' === scope) {
    return fields.length
  }

  const idx = fields.findIndex((field) => axisName(field) === scope)

  if (idx < 0) {
    throw error('role-scope-unknown', { scope })
  }

  return idx
}

function buildGrantSpec(deep: any, options: BuildRolesOptions, grantSpec: any, cutoff: number) {
  const spec = deep({}, grantSpec)

  if (cutoff <= 0) {
    return spec
  }

  spec.read = spec.read || {}
  spec.write = spec.write || {}

  const fields = options.fields || []

  for (let i = 0; i < fields.length && i < cutoff; i++) {
    spec.read[fields[i]] = false
    spec.write[fields[i]] = false
  }

  return spec
}

// No `inherits` or `inherits: []` / 'none' / null: no implicit inheritance.
function resolveInherits(name: string, role: Role, roles: Roles) {
  const inh = role.inherits

  if (null == inh || 'none' === inh) {
    return []
  }

  return Array.isArray(inh) ? inh : [inh]
}

// Transitive closure over inherit edges. Memoized DFS; `visiting` detects
// cycles. Parents merge first, own grants last, so own spec wins.
function effectivePermissions(
  deep: any,
  error: BuildRolesUtils['error'],
  roles: Roles,
  memo: Memo,
  visiting: Set<string>,
  name: string
): Permission[] {
  if (name in memo) {
    return memo[name]
  }

  if (visiting.has(name)) {
    throw error('role-inherit-cycle', { role: name })
  }

  if (null == roles[name]) {
    throw error('role-inherit-unknown', { role: name })
  }

  visiting.add(name)

  const role = roles[name]
  let permissions: Permission[] = []

  for (const parent of resolveInherits(name, role, roles)) {
    permissions = mergePermissions(
      deep, permissions,
      effectivePermissions(deep, error, roles, memo, visiting, parent)
    )
  }

  const own = (role.grants || []).map(normalizeGrant)
  permissions = mergePermissions(deep, permissions, own)

  visiting.delete(name)
  return (memo[name] = permissions)
}

export function build_roles(
  options: BuildRolesOptions,
  utils: BuildRolesUtils
): CompiledRoles {
  const { deep, Patrun, error } = utils
  const roles = options.roles || {}

  const memo: Memo = {}
  const visiting = new Set<string>()

  const compiled: CompiledRoles = {}

  Object.keys(roles).forEach((name: string) => {
    const role = roles[name] || {}
    const cutoff = scopeCutoff(options, error, role.scope)
    const permissions = effectivePermissions(deep, error, roles, memo, visiting, name)

    const patrun = Patrun()
    permissions.forEach((perm: any) => {
      patrun.add(
        entityPat(perm.entity),
        { ops: perm.ops, spec: buildGrantSpec(deep, options, perm.spec, cutoff) }
      )
    })

    compiled[name] = patrun
  })

  return compiled
}
