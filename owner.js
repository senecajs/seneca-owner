/* Copyright (c) 2018-2019 voxgig and other contributors, MIT License */
'use strict'

const Util = require('util')

const Joi = require('@hapi/joi')

module.exports = owner
module.exports.defaults = {
  default_spec: Joi.object().default({
    active: true,
    fields: [],
    read: {
      // default true
      //usr: true,
      //org: true
    },
    write: {
      // default true
      //usr: true,
      //org: true
    },
    inject: {
      // default true
      //usr: true,
      //org: true
    },
    alter: {
      // default false
      //usr: false,
      //org: false
    }
  }),

  specprop: Joi.string().default('sys-owner-spec'),
  ownerprop: Joi.string().default('sys-owner'),
  caseprop: Joi.string().default('case$'),
  entprop: Joi.string().default('ent'),
  queryprop: Joi.string().default('q'),
  annotate: Joi.array().default([]),
  fields: Joi.array().default([]),
  owner_required: Joi.boolean().default(true)
}

function owner(options) {
  const seneca = this

  intern.deepextend = seneca.util.deepextend

  options.default_spec.fields = [
    ...new Set(options.default_spec.fields.concat(options.fields))
  ]
  intern.default_spec = intern.make_spec(options.default_spec)

  const casemap = {}

  this.fix('sys:owner').add('hook:case', hook_case)

  // TODO: allow multiple ordered cases
  function hook_case(msg, reply) {
    var kase = msg.case
    var modifiers = msg.modifiers

    if ('string' === typeof kase && 'object' === typeof modifiers) {
      casemap[kase] = modifiers
    }

    reply()
  }

  const specP = options.specprop
  const ownerprop = options.ownerprop
  const caseP = options.caseprop
  const entprop = options.entprop
  const queryprop = options.queryprop

  const annotate = options.annotate.map(p => seneca.util.Jsonic(p))

  annotate.forEach(function(msgpat) {
    var owner = function owner(msg, reply, meta) {
      var self = this
      var explain = this.explain()

      var expdata = explain && {
        when: Date.now(),
        msgpat: msgpat,
        msgid: meta.id,
        modifiers: {},
        options: options
      }

      var spec = self.util.deepextend(meta.custom[specP] || intern.default_spec)
      var owner = meta.custom[ownerprop]

      if (!owner && !options.owner_required) {
        explain && ((expdata.owner_required = false), (expdata.pass = true))
        return intern.prior(self, msg, reply, explain, expdata)
      }

      var modifiers = {}
      if (owner && casemap[owner[caseP]]) {
        modifiers = casemap[owner[caseP]]
      }

      if (modifiers.query) {
        explain && (expdata.modifiers.query = true)
        spec = modifiers.query(spec, owner, msg)
      }

      explain &&
        ((expdata.owner = owner), (expdata.spec = self.util.deepextend(spec)))

      if (spec.active) {
        if ('list' === msg.cmd) {
          explain && (expdata.path = 'list')

          intern.refine_query(self, msg, queryprop, spec, owner)
          explain && (expdata.query = msg[queryprop])

          return self.prior(msg, function(err, list) {
            if (err) return reply(err)
            if (null == list) return reply()

            if (modifiers.list) {
              explain &&
                ((expdata.modifiers.list = true),
                (expdata.orig_list_len = list ? list.length : 0))
              list = modifiers.list(spec, owner, msg, list)
            }

            explain && (expdata.list_len = list ? list.length : 0)

            return intern.reply(self, reply, list, explain, expdata)
          })
        }

        // handle remove operation
        else if ('remove' === msg.cmd) {
          explain && (expdata.path = 'remove')

          intern.refine_query(self, msg, queryprop, spec, owner)
          explain && (expdata.query = msg[queryprop])

          self.make(msg.ent.entity$).list$(msg.q, function(err, list) {
            if (err) return self.fail(err)

            if (modifiers.list) {
              explain &&
                ((expdata.modifiers.list = true),
                (expdata.orig_list_len = list ? list.length : 0))
              list = modifiers.list(spec, owner, msg, list)
            }

            if (0 < list.length) {
              explain &&
                ((expdata.empty = false),
                (expdata.list_len = list ? list.length : 0))

              return intern.prior(self, msg, reply, explain, expdata)
            }

            // nothing to delete
            else {
              explain && (expdata.empty = true)

              return intern.reply(self, reply, void 0, explain, expdata)
            }
          })
        }

        // handle load operation
        else if ('load' === msg.cmd) {
          explain && (expdata.path = 'load')

          // only change query if not loading by id - preserves caching!
          if (null == msg[queryprop].id) {
            intern.refine_query(self, msg, queryprop, spec, owner)
            explain && (expdata.query = msg[queryprop])
          }

          self.prior(msg, function(err, load_ent) {
            if (err) return reply(err)
            if (null == load_ent) return reply()

            // was not an id-based query, so refinement already made
            if (null == msg[queryprop].id) {
              explain && ((expdata.query_load = true), (expdata.ent = load_ent))

              return intern.reply(self, reply, load_ent, explain, expdata)
            }

            if (modifiers.entity) {
              explain && (expdata.modifiers.entity = true)

              spec = modifiers.entity(spec, owner, msg, load_ent)
              explain && (expdata.modifiers.entity_spec = spec)
            }

            var pass = true
            for (var i = 0; i < spec.fields.length; i++) {
              var f = spec.fields[i]

              // need this field to match owner for ent to be readable
              if (spec.read[f]) {
                pass = pass && intern.match(owner[f], load_ent[f])

                if (!pass) {
                  explain &&
                    (expdata.field_match_fail = {
                      field: f,
                      ent_val: load_ent[f],
                      owner_val: owner[f]
                    })
                  break
                }
              }
            }

            explain && ((expdata.pass = pass), (expdata.ent = load_ent))

            return intern.reply(
              self,
              reply,
              pass ? load_ent : null,
              explain,
              expdata
            )
          })
        }

        // handle save operation
        else if ('save' === msg.cmd) {
          explain && (expdata.path = 'save')

          var ent = msg[entprop]

          // only set fields props if not already set
          for (var i = 0; i < spec.fields.length; i++) {
            var f = spec.fields[i]
            if (spec.inject[f] && null == ent[f] && null != owner[f]) {
              ent[f] = Array.isArray(owner[f]) ? owner[f][0] : owner[f]
            }
          }

          // creating
          if (null == ent.id) {
            explain && (expdata.path = 'save/create')

            for (var i = 0; i < spec.fields.length; i++) {
              var f = spec.fields[i]
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
                  }
                  explain && (expdata.fail = fail)

                  return intern.fail(self, reply, fail, explain, expdata)
                }
              }
            }

            return intern.prior(self, msg, reply, explain, expdata)
          }

          // updating
          else {
            explain && (expdata.path = 'save/update')

            // TODO: seneca entity update would really help there!
            self.make(ent.entity$).load$(ent.id, function(err, oldent) {
              if (err) return this.fail(err)
              if (null == oldent) {
                var fail = {
                  code: 'save-not-found',
                  details: { entity: ent.entity$, id: ent.id }
                }

                explain && (expdata.fail = fail)
                return intern.fail(self, reply, fail, explain, expdata)
              }

              for (var i = 0; i < spec.fields.length; i++) {
                var f = spec.fields[i]
                if (spec.write[f] && !spec.alter[f] && oldent[f] !== ent[f]) {
                  var fail = {
                    code: 'update-not-allowed',
                    details: {
                      why: 'field-mismatch-on-update',
                      field: f,
                      oldent_val: oldent[f],
                      ent_val: ent[f]
                    }
                  }
                  explain && (expdata.fail = fail)

                  return intern.fail(self, reply, fail, explain, expdata)
                }
              }

              explain && (expdata.save = true)
              return intern.prior(self, msg, reply, explain, expdata)
            })
          }
        }
      }

      // not active, do nothing
      else {
        explain && (expdata.active = false)
        return intern.prior(self, msg, reply, explain, expdata)
      }
    }

    owner.desc = 'Validate owner for ' + seneca.util.pattern(msgpat)

    seneca.add(msgpat, owner)
  })

  return {
    exports: {
      make_spec: intern.make_spec,
      config: {
        spec: intern.default_spec,
        options: options
      }
    }
  }
}

const intern = (owner.intern = {
  default_spec: null,
  deepextend: null,

  make_spec: function(inspec) {
    const spec = intern.deepextend({}, intern.default_spec, inspec)
    spec.fields = [...new Set(spec.fields)]
    ;['write', 'read', 'inject', 'alter'].forEach(m => {
      spec[m] = spec[m] || {}
    })

    spec.fields.forEach(function(f) {
      spec.write[f] = null == spec.write[f] ? true : spec.write[f]
      spec.read[f] = null == spec.read[f] ? true : spec.read[f]
      spec.inject[f] = null == spec.inject[f] ? true : spec.inject[f]
    })
    ;['write', 'read', 'inject', 'alter'].forEach(m => {
      spec.fields = [...new Set(spec.fields.concat(Object.keys(spec[m])))]
    })

    return spec
  },

  refine_query: function(seneca, msg, queryprop, spec, owner) {
    msg[queryprop] = msg[queryprop] || {}
    spec.fields.forEach(function(f) {
      if (spec.read[f]) {
        if (Array.isArray(owner[f])) {
          if (null == msg[queryprop][f]) {
            //msg[queryprop][f] = owner[f][0]
            msg[queryprop][f] = owner[f] // seneca store must support $in-style queries
          } else if (Array.isArray(msg[queryprop][f])) {
            // need an intersection to match
            var merge = [...new Set(owner[f], msg[queryprop][f])]
            if (merge.length === owner[f].length + msg[queryprop][f].length) {
              seneca.fail('field-values-not-valid', {
                field: f,
                query_val: msg[queryprop][f],
                valid_owner_vals: owner[f]
              })
            }
          } else if (!owner[f].includes(msg[queryprop][f])) {
            seneca.fail('field-not-valid', {
              field: f,
              query_val: msg[queryprop][f],
              valid_owner_vals: owner[f]
            })
          }
        } else {
          msg[queryprop][f] = owner[f]
        }

        // remove from query if value is null
        if (null == msg[queryprop][f]) {
          delete msg[queryprop][f]
        }
      }
    })
  },

  match: function(matching_val, check_val) {
    // match if check_val (from ent) is undefined (thus not considered), or
    // if check_val (from ent) equals one of the valid matching vals
    return (
      void 0 === check_val ||
      (Array.isArray(matching_val) && matching_val.includes(check_val)) ||
      check_val === matching_val
    )
  },

  prior: function(self, msg, reply, explain, expdata) {
    explain && explain(expdata)
    return self.prior(msg, reply)
  },

  reply: function(self, reply, result, explain, expdata) {
    explain && explain(expdata)
    return reply(result)
  },

  fail: function(self, reply, fail, explain, expdata) {
    explain && explain(expdata)
    return reply(self.error(fail.code, fail.details))
  }
})
