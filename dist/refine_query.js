"use strict";
/* Copyright (c) 2018-2020 Voxgig and other contributors, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.refine_query = void 0;
function refine_query(seneca, msg, queryprop, spec, owner, intern, resolvedFieldNames) {
    let q = (msg[queryprop] = msg[queryprop] || {});
    // console.log('RQ', q)
    // backwards compat
    spec.public = spec.public || { read: {} };
    let public_field = spec.public.read['*'];
    // List public data, regardless of ownership fields. Note that the
    // public flag field is in the query, so excludes private data!
    if (null != public_field && true === !!(q[public_field])) {
        return;
    }
    for (let fieldName of spec.fields) {
        const [ownerFieldName, entityFieldName] = (resolvedFieldNames[fieldName] ||
            (resolvedFieldNames[fieldName] =
                intern.resolveFieldNames(fieldName)));
        let enforce_read_perm = spec.read[fieldName] &&
            false === !!(q[spec.public.read[fieldName]]);
        if (!enforce_read_perm)
            continue;
        let owner_value = owner[ownerFieldName];
        if (Array.isArray(owner_value)) {
            if (null == q[entityFieldName]) {
                q[entityFieldName] = owner_value; // seneca store must support $in-style queries
            }
            else if (Array.isArray(q[entityFieldName])) {
                for (let qval of q[entityFieldName]) {
                    if (!owner_value.includes(qval)) {
                        seneca.fail('field-values-not-valid', {
                            field: fieldName,
                            entityFieldName,
                            ownerFieldName,
                            query_val: q[entityFieldName],
                            bad_query_val: qval,
                            valid_owner_vals: owner_value
                        });
                    }
                }
            }
            else if (!owner_value.includes(q[entityFieldName])) {
                seneca.fail('field-not-valid', {
                    field: fieldName,
                    entityFieldName,
                    ownerFieldName,
                    query_val: q[entityFieldName],
                    bad_query_val: q[entityFieldName],
                    valid_owner_vals: owner_value
                });
            }
        }
        else {
            q[entityFieldName] = owner_value;
        }
        if (null == q[entityFieldName]) {
            delete q[entityFieldName];
        }
    }
}
exports.refine_query = refine_query;
//# sourceMappingURL=refine_query.js.map