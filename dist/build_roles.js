"use strict";
/* Copyright (c) 2018-2026 Voxgig and other contributors, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_roles = build_roles;
// A grant is a string entity pattern or { entity, ops?, spec? }. ops use seneca
// method names (list$ ...); strip the $ to match msg.cmd.
function normalizeGrant(grant) {
    if ('string' === typeof grant) {
        grant = { entity: grant };
    }
    const allOps = ['list$', 'load$', 'save$', 'remove$'];
    const ops = new Set((grant.ops || allOps).map((op) => ('' + op).replace(/\$$/, '')));
    return { entity: '' + grant.entity, ops, spec: grant.spec || {} };
}
// Merge two permission lists into a superset keyed by entity: ops union, later
// spec wins. `add` is applied over `base`, so callers pass the more senior list
// last. Returns fresh objects so a memoized result stays safe to reuse.
function mergePermissions(deep, base, add) {
    const byEntity = {};
    base.concat(add).forEach((perm) => {
        const prev = byEntity[perm.entity];
        if (!prev) {
            byEntity[perm.entity] = {
                entity: perm.entity,
                ops: new Set(perm.ops),
                spec: deep({}, perm.spec)
            };
        }
        else {
            perm.ops.forEach((op) => prev.ops.add(op));
            prev.spec = deep(prev.spec, perm.spec);
        }
    });
    return Object.values(byEntity);
}
// Entity pattern -> Patrun match key. '*' any, 'base/*' whole base, else exact.
function entityPat(entity) {
    if ('*' === entity) {
        return {};
    }
    const [base, name] = entity.split('/');
    return (null == name || '*' === name) ? { base } : { base, name };
}
// Fold scope:'org' into a spec fragment: disable the owner-axis field so the
// role reads/writes across users, while the tenant axis stays enforced.
function buildGrantSpec(deep, opts, grantSpec, scopeOrg) {
    const spec = deep({}, grantSpec);
    if (!scopeOrg) {
        return spec;
    }
    spec.read = spec.read || {};
    spec.write = spec.write || {};
    for (const field of (opts.fields || [])) {
        const parts = ('' + field).split(':');
        const entityField = null == parts[1] ? parts[0] : parts[1];
        if (entityField === opts.ownerfield) {
            spec.read[field] = false;
            spec.write[field] = false;
        }
    }
    return spec;
}
// Resolve a role's inherit edges. Default: inherit `member`. `member` is the
// root. Explicit `inherits: []` / 'none' / null opts out.
function resolveInherits(name, role) {
    if ('member' === name) {
        return [];
    }
    const inh = role.inherits;
    if (undefined === inh) {
        return ['member'];
    }
    if (null == inh || 'none' === inh) {
        return [];
    }
    return Array.isArray(inh) ? inh : [inh];
}
// Effective permissions = transitive closure over inherit edges. Memoized DFS:
// `visiting` holds the roles on the current stack, so re-entering one is a
// cycle. Parents merge first, own grants last, so a role's own spec wins.
function effectivePermissions(deep, error, roles, memo, visiting, name) {
    if (name in memo) {
        return memo[name];
    }
    if (visiting.has(name)) {
        throw error('role-inherit-cycle', { role: name });
    }
    if (null == roles[name]) {
        throw error('role-inherit-unknown', { role: name });
    }
    visiting.add(name);
    const role = roles[name];
    let permissions = [];
    for (const parent of resolveInherits(name, role)) {
        permissions = mergePermissions(deep, permissions, effectivePermissions(deep, error, roles, memo, visiting, parent));
    }
    const own = (role.grants || []).map(normalizeGrant);
    permissions = mergePermissions(deep, permissions, own);
    visiting.delete(name);
    return (memo[name] = permissions);
}
function build_roles(opts, deps) {
    const { deep, Patrun, error } = deps;
    const roles = opts.roles || {};
    const memo = {};
    const visiting = new Set();
    const compiled = {};
    Object.keys(roles).forEach((name) => {
        const role = roles[name] || {};
        // scope is role-level: scopeOrg applies to ALL of this role's effective
        // permissions (inherited + own).
        const scopeOrg = 'org' === role.scope;
        const permissions = effectivePermissions(deep, error, roles, memo, visiting, name);
        const patrun = Patrun();
        permissions.forEach((perm) => {
            patrun.add(entityPat(perm.entity), { ops: perm.ops, spec: buildGrantSpec(deep, opts, perm.spec, scopeOrg) });
        });
        compiled[name] = patrun;
    });
    return compiled;
}
//# sourceMappingURL=build_roles.js.map