"use strict";
/* Copyright (c) 2018-2026 Voxgig and other contributors, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.axisName = axisName;
exports.build_roles = build_roles;
function normalizeGrant(grant) {
    if ('string' === typeof grant) {
        grant = { entity: grant };
    }
    const allOps = ['list$', 'load$', 'save$', 'remove$'];
    // ops are seneca method names; strip the $ to match msg.cmd.
    const ops = new Set((grant.ops || allOps).map((op) => ('' + op).replace(/\$$/, '')));
    return { entity: '' + grant.entity, ops, spec: grant.spec || {} };
}
// Union two permission lists keyed by entity: ops union, later spec wins.
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
// Enforced axis name of a `fields` entry: entity-side of `owner:entity`.
function axisName(field) {
    const parts = ('' + field).split(':');
    return null == parts[1] ? parts[0] : parts[1];
}
// Scope -> cutoff index: axes before it (more specific) are relaxed, the scope
// axis and broader stay enforced. null: relax none. '*': relax all (global).
function scopeCutoff(opts, error, scope) {
    const fields = opts.fields || [];
    if (null == scope) {
        return 0;
    }
    if ('*' === scope) {
        return fields.length;
    }
    const idx = fields.findIndex((field) => axisName(field) === scope);
    if (idx < 0) {
        throw error('role-scope-unknown', { scope });
    }
    return idx;
}
function buildGrantSpec(deep, opts, grantSpec, cutoff) {
    const spec = deep({}, grantSpec);
    if (cutoff <= 0) {
        return spec;
    }
    spec.read = spec.read || {};
    spec.write = spec.write || {};
    const fields = opts.fields || [];
    for (let i = 0; i < fields.length && i < cutoff; i++) {
        spec.read[fields[i]] = false;
        spec.write[fields[i]] = false;
    }
    return spec;
}
// No `inherits`: inherit `member` when one exists, else nothing. `member` is
// the root. `inherits: []` / 'none' / null opts out.
function resolveInherits(name, role, roles) {
    if ('member' === name) {
        return [];
    }
    const inh = role.inherits;
    if (undefined === inh) {
        return null != roles['member'] ? ['member'] : [];
    }
    if (null == inh || 'none' === inh) {
        return [];
    }
    return Array.isArray(inh) ? inh : [inh];
}
// Transitive closure over inherit edges. Memoized DFS; `visiting` detects
// cycles. Parents merge first, own grants last, so own spec wins.
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
    for (const parent of resolveInherits(name, role, roles)) {
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
        const cutoff = scopeCutoff(opts, error, role.scope);
        const permissions = effectivePermissions(deep, error, roles, memo, visiting, name);
        const patrun = Patrun();
        permissions.forEach((perm) => {
            patrun.add(entityPat(perm.entity), { ops: perm.ops, spec: buildGrantSpec(deep, opts, perm.spec, cutoff) });
        });
        compiled[name] = patrun;
    });
    return compiled;
}
//# sourceMappingURL=build_roles.js.map