/* Copyright (c) 2018-2020 Voxgig and other contributors, MIT License */
/* $lab:coverage:off$ */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const gubu_1 = require("gubu");
const refine_query_1 = require("./refine_query");
/* $lab:coverage:on$ */
const { Open, Any } = gubu_1.Gubu;
const defaults = {
    default_spec: {
        active: true,
        fields: [],
        read: Open({
        // default true
        //usr: true,
        //org: true
        }),
        write: Open({
        // default true
        //usr: true,
        //org: true
        }),
        inject: Open({
        // default true
        //usr: true,
        //org: true
        }),
        alter: Open({
        // default false
        //usr: false,
        //org: false
        }),
        public: Open({
            read: Open({
            // field -> public boolean field
            })
        })
    },
    specprop: 'sys-owner-spec',
    ownerprop: 'sysowner',
    caseprop: 'case$',
    entprop: 'ent',
    queryprop: 'q',
    annotate: [],
    fields: [],
    owner_required: true,
    explain: Any(),
    include: {
        custom: Open({})
    }
};
function Owner(options) {
    const seneca = this;
    const { deep } = seneca.util;
    intern.deepextend = seneca.util.deepextend;
    options.default_spec.fields = [
        ...new Set(options.default_spec.fields.concat(options.fields))
    ];
    // intern.default_spec = intern.make_spec(options.default_spec)
    const default_spec = intern.make_spec(options.default_spec, {});
    const casemap = {};
    this.fix('sys:owner').add('hook:case', hook_case);
    // TODO: allow multiple ordered cases
    function hook_case(msg, reply) {
        var kase = msg.case;
        var modifiers = msg.modifiers;
        if ('string' === typeof kase && 'object' === typeof modifiers) {
            casemap[kase] = modifiers;
        }
        reply();
    }
    const specP = options.specprop;
    const ownerprop = options.ownerprop;
    const caseP = options.caseprop;
    const entprop = options.entprop;
    const queryprop = options.queryprop;
    const include = options.include;
    const hasInclude = 0 < Object.keys(include).length;
    // By default, ownerprop needed to activate
    include.custom = deep({ [ownerprop]: { owner$: 'exists' } }, include.custom);
    const annotate = options.annotate.map((p) => seneca.util.Jsonic(p));
    annotate.forEach(function (msgpat) {
        var owner = function owner(msg, reply, meta) {
            var self = this;
            var explain = this.explain();
            var expdata = explain && {
                when: Date.now(),
                msgpat: msgpat,
                msgid: meta.id,
                modifiers: {},
                options: options
            };
            var spec = self.util.deepextend(meta.custom[specP] || default_spec);
            var owner = meta.custom[ownerprop];
            if (!owner && !options.owner_required) {
                explain && ((expdata.owner_required = false), (expdata.pass = true));
                return intern.prior(self, msg, reply, explain, expdata);
            }
            var modifiers = {};
            if (owner && casemap[owner[caseP]]) {
                modifiers = casemap[owner[caseP]];
            }
            if (modifiers.query) {
                explain && (expdata.modifiers.query = true);
                spec = modifiers.query.call(self, spec, owner, msg);
            }
            explain &&
                ((expdata.owner = owner), (expdata.spec = self.util.deepextend(spec)));
            let active = spec.active;
            if (active && hasInclude) {
                if (include.custom) {
                    let cip;
                    for (cip in include.custom) {
                        active = active && (include.custom[cip] === meta.custom[cip] ||
                            ('exists' === include.custom[cip].owner$ && null != meta.custom[cip]));
                        if (!active) {
                            break;
                        }
                    }
                    explain && ((expdata.include_custom = active),
                        (!active && (expdata.include_custom_prop = cip)));
                }
            }
            // console.log('QQQ', active, hasInclude, include.custom, meta.custom, msg)
            if (active) {
                if ('list' === msg.cmd) {
                    explain && (expdata.path = 'list');
                    (0, refine_query_1.refine_query)(self, msg, queryprop, spec, owner);
                    explain && (expdata.query = msg[queryprop]);
                    return self.prior(msg, function (err, list) {
                        if (err)
                            return reply(err);
                        if (null == list)
                            return reply();
                        if (modifiers.list) {
                            explain &&
                                ((expdata.modifiers.list = true),
                                    (expdata.orig_list_len = list ? list.length : 0));
                            list = modifiers.list.call(self, spec, owner, msg, list);
                        }
                        explain && (expdata.list_len = list ? list.length : 0);
                        return intern.reply(self, reply, list, explain, expdata);
                    });
                }
                // handle remove operation
                else if ('remove' === msg.cmd) {
                    explain && (expdata.path = 'remove');
                    (0, refine_query_1.refine_query)(self, msg, queryprop, spec, owner);
                    explain && (expdata.query = msg[queryprop]);
                    self.make(msg.ent.entity$).list$(msg.q, function (err, list) {
                        if (err)
                            return self.fail(err);
                        if (modifiers.list) {
                            explain &&
                                ((expdata.modifiers.list = true),
                                    (expdata.orig_list_len = list ? list.length : 0));
                            list = modifiers.list.call(self, spec, owner, msg, list);
                        }
                        // TODO: should use list result ids!!!
                        if (0 < list.length) {
                            explain &&
                                ((expdata.empty = false),
                                    (expdata.list_len = list ? list.length : 0));
                            return intern.prior(self, msg, reply, explain, expdata);
                        }
                        // nothing to delete
                        else {
                            explain && (expdata.empty = true);
                            return intern.reply(self, reply, void 0, explain, expdata);
                        }
                    });
                }
                // handle load operation
                else if ('load' === msg.cmd) {
                    explain && (expdata.path = 'load');
                    // only change query if not loading by id - preserves caching!
                    if (null == msg[queryprop].id) {
                        (0, refine_query_1.refine_query)(self, msg, queryprop, spec, owner);
                        explain && (expdata.query = msg[queryprop]);
                    }
                    self.prior(msg, function (err, load_ent) {
                        if (err)
                            return reply(err);
                        if (null == load_ent)
                            return reply();
                        // was not an id-based query, so refinement already made
                        if (null == msg[queryprop].id) {
                            explain && ((expdata.query_load = true), (expdata.ent = load_ent));
                            return intern.reply(self, reply, load_ent, explain, expdata);
                        }
                        if (modifiers.entity) {
                            explain && (expdata.modifiers.entity = true);
                            spec = modifiers.entity.call(self, spec, owner, msg, load_ent);
                            explain && (expdata.modifiers.entity_spec = spec);
                        }
                        var pass = true;
                        for (var i = 0; i < spec.fields.length; i++) {
                            var f = spec.fields[i];
                            // need this field to match owner for ent to be readable
                            if (spec.read[f]) {
                                pass = pass && intern.match(owner[f], load_ent[f]);
                                if (!pass) {
                                    explain &&
                                        (expdata.field_match_fail = {
                                            field: f,
                                            ent_val: load_ent[f],
                                            owner_val: owner[f]
                                        });
                                    break;
                                }
                            }
                        }
                        explain && ((expdata.pass = pass), (expdata.ent = load_ent));
                        return intern.reply(self, reply, pass ? load_ent : null, explain, expdata);
                    });
                }
                // handle save operation
                else if ('save' === msg.cmd) {
                    explain && (expdata.path = 'save');
                    var ent = msg[entprop];
                    // console.log('OWNER save A', ent, spec)
                    // only set fields props if not already set
                    for (var i = 0; i < spec.fields.length; i++) {
                        var f = spec.fields[i];
                        if (spec.inject[f] && null == ent[f] && null != owner[f]) {
                            ent[f] = Array.isArray(owner[f]) ? owner[f][0] : owner[f];
                        }
                    }
                    // creating
                    if (null == ent.id) {
                        explain && (expdata.path = 'save/create');
                        for (i = 0; i < spec.fields.length; i++) {
                            f = spec.fields[i];
                            if (spec.write[f] && null != ent[f]) {
                                if (!intern.match(owner[f], ent[f])) {
                                    var fail = {
                                        code: 'create-not-allowed',
                                        details: {
                                            why: 'field-mismatch-on-create',
                                            field: f,
                                            ent_val: ent[f],
                                            owner_val: owner[f]
                                        }
                                    };
                                    explain && (expdata.fail = fail);
                                    return intern.fail(self, reply, fail, explain, expdata);
                                }
                            }
                        }
                        return intern.prior(self, msg, reply, explain, expdata);
                    }
                    // updating
                    else {
                        explain && (expdata.path = 'save/update');
                        let fail;
                        // TODO: seneca entity update would really help there!
                        self.make(ent.entity$).load$(ent.id, function (err, oldent) {
                            if (err)
                                return this.fail(err);
                            if (null == oldent) {
                                fail = {
                                    code: 'save-not-found',
                                    details: { entity: ent.entity$, id: ent.id }
                                };
                                explain && (expdata.fail = fail);
                                return intern.fail(self, reply, fail, explain, expdata);
                            }
                            for (var i = 0; i < spec.fields.length; i++) {
                                var f = spec.fields[i];
                                if (spec.write[f] && !spec.alter[f] && oldent[f] !== ent[f]) {
                                    fail = {
                                        code: 'update-not-allowed',
                                        details: {
                                            why: 'field-mismatch-on-update',
                                            field: f,
                                            oldent_val: oldent[f],
                                            ent_val: ent[f]
                                        }
                                    };
                                    explain && (expdata.fail = fail);
                                    return intern.fail(self, reply, fail, explain, expdata);
                                }
                            }
                            explain && (expdata.save = true);
                            return intern.prior(self, msg, reply, explain, expdata);
                        });
                    }
                }
            }
            // not active, do nothing
            else {
                explain && (expdata.active = false);
                return intern.prior(self, msg, reply, explain, expdata);
            }
        };
        owner.desc = 'Validate owner for ' + seneca.util.pattern(msgpat);
        // seneca.add(msgpat, owner)
        seneca.wrap(msgpat, owner);
        //if (!seneca.find(msgpat, { exact: true })) {
        seneca.add(msgpat, owner);
        // }
    });
    return {
        exports: {
            make_spec: (inspec) => intern.make_spec(inspec, default_spec),
            casemap: casemap,
            config: {
                spec: default_spec,
                options: options
            }
        }
    };
}
const intern = (Owner.intern = {
    // default_spec: null,
    deepextend: (a, b, c) => null,
    make_spec: function (inspec, default_spec) {
        const spec = intern.deepextend({}, default_spec, inspec);
        spec.fields = [...new Set(spec.fields)];
        ['write', 'read', 'inject', 'alter'].forEach(m => {
            spec[m] = spec[m] || {};
        });
        spec.fields.forEach(function (f) {
            spec.write[f] = null == spec.write[f] ? true : spec.write[f];
            spec.read[f] = null == spec.read[f] ? true : spec.read[f];
            spec.inject[f] = null == spec.inject[f] ? true : spec.inject[f];
        });
        ['write', 'read', 'inject', 'alter'].forEach(m => {
            spec.fields = [...new Set(spec.fields.concat(Object.keys(spec[m])))];
        });
        spec.public = spec.public || {};
        spec.public.read = spec.public.read || {};
        return spec;
    },
    match: function (matching_val, check_val) {
        // match if check_val (from ent) is undefined (thus not considered), or
        // if check_val (from ent) equals one of the valid matching vals
        return (void 0 === check_val ||
            (Array.isArray(matching_val) && matching_val.includes(check_val)) ||
            check_val === matching_val);
    },
    prior: function (self, msg, reply, explain, expdata) {
        explain && explain(expdata);
        return self.prior(msg, reply);
    },
    reply: function (self, reply, result, explain, expdata) {
        explain && explain(expdata);
        return reply(result);
    },
    fail: function (self, reply, fail, explain, expdata) {
        explain && explain(expdata);
        return reply(self.error(fail.code, fail.details));
    }
});
Object.assign(Owner, { defaults });
// Prevent name mangling
Object.defineProperty(Owner, 'name', { value: 'Owner' });
exports.default = Owner;
if ('undefined' !== typeof module) {
    module.exports = Owner;
}
//# sourceMappingURL=Owner.js.map