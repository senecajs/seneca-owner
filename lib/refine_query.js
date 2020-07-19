"use strict";
/* Copyright (c) 2018-2020 Voxgig and other contributors, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.refine_query = void 0;
function refine_query(seneca, msg, queryprop, spec, owner) {
    let q = (msg[queryprop] = msg[queryprop] || {});
    spec.fields.forEach(function (f) {
        if (spec.read[f]) {
            if (Array.isArray(owner[f])) {
                if (null == q[f]) {
                    q[f] = owner[f]; // seneca store must support $in-style queries
                }
                else if (Array.isArray(q[f])) {
                    // need an intersection to match
                    var merge_uniq = [...new Set([...owner[f], ...q[f]])];
                    // no intersection if no common values
                    if (merge_uniq.length === owner[f].length + q[f].length) {
                        seneca.fail('field-values-not-valid', {
                            field: f,
                            query_val: q[f],
                            valid_owner_vals: owner[f]
                        });
                    }
                }
                else if (!owner[f].includes(q[f])) {
                    seneca.fail('field-not-valid', {
                        field: f,
                        query_val: q[f],
                        valid_owner_vals: owner[f]
                    });
                }
            }
            else {
                q[f] = owner[f];
            }
            // remove from query if value is null
            if (null == q[f]) {
                delete q[f];
            }
        }
    });
}
exports.refine_query = refine_query;
//# sourceMappingURL=refine_query.js.map