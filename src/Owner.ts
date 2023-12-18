/* Copyright (c) 2018-2020 Voxgig and other contributors, MIT License */
/* $lab:coverage:off$ */
'use strict'


import { Gubu } from 'gubu'

import { refine_query } from './refine_query'

/* $lab:coverage:on$ */

const { Open, Any } = Gubu


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
}



function Owner(this: any, options: any) {
  const seneca = this

  const { deep } = seneca.util

  intern.deepextend = seneca.util.deepextend

  options.default_spec.fields = [
    ...new Set(options.default_spec.fields.concat(options.fields))
  ]
  // intern.default_spec = intern.make_spec(options.default_spec)
  const default_spec = intern.make_spec(options.default_spec, {})



  const casemap: any = {}

  this.fix('sys:owner').add('hook:case', hook_case)

  // TODO: allow multiple ordered cases
  function hook_case(msg: any, reply: any) {
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

  const include = options.include
  const hasInclude = 0 < Object.keys(include).length

  const resolvedFieldNames: { [fieldName: string]: string[] } = {}

  // By default, ownerprop needed to activate
  include.custom = deep({ [ownerprop]: { owner$: 'exists' } }, include.custom)

  const annotate = options.annotate.map((p: any) => seneca.util.Jsonic(p))

  annotate.forEach(function(msgpat: any) {
    const checkOwner: any = function checkOwner(this: any, msg: any, reply: any, meta: any) {
      const self = this
      const explain = this.explain()

      const expdata: any = explain && {
        when: Date.now(),
        msgpat: msgpat,
        msgid: meta.id,
        modifiers: {},
        options: options
      }

      let spec = self.util.deepextend(meta.custom[specP] || default_spec)
      const owner = meta.custom[ownerprop] || getprop(meta.custom, ownerprop)

      if (!owner && !options.owner_required) {
        explain && ((expdata.owner_required = false), (expdata.pass = true))
        return intern.prior(self, msg, reply, explain, expdata)
      }

      let modifiers: any = {}
      if (owner && casemap[owner[caseP]]) {
        modifiers = casemap[owner[caseP]]
      }

      if (modifiers.query) {
        explain && (expdata.modifiers.query = true)
        spec = modifiers.query.call(self, spec, owner, msg)
      }

      explain &&
        ((expdata.owner = owner), (expdata.spec = self.util.deepextend(spec)))

      let active = spec.active

      if (active && hasInclude) {
        if (include.custom) {
          let cip, cval, mval
          for (cip in include.custom) {
            active = active && (

              // direct prop
              (((cval = include.custom[cip]) === (mval = meta.custom[cip])) && null != cval) ||
              ((cval && ('exists' === cval.owner$ && null != mval)) && null != cval) ||

              // path prop
              ((cval === (mval = getprop(meta.custom, cip))) && null != cval) ||
              ((cval && ('exists' === cval.owner$ && null != mval)) && null != cval)
            )
            // console.log('CIP', cip, active, include.custom, meta.custom)

            if (!active) { break }
          }
          explain && ((expdata.include_custom = active),
            (!active && (expdata.include_custom_prop = cip)))
        }
      }

      // console.log('QQQ', active, hasInclude, include.custom, meta.custom, msg)

      if (active) {
        if ('list' === msg.cmd) {
          explain && (expdata.path = 'list')

          refine_query(self, msg, queryprop, spec, owner, intern, resolvedFieldNames)
          explain && (expdata.query = msg[queryprop])

          return self.prior(msg, function(err: any, list: any) {
            if (err) return reply(err)
            if (null == list) return reply()

            if (modifiers.list) {
              explain &&
                ((expdata.modifiers.list = true),
                  (expdata.orig_list_len = list ? list.length : 0))
              list = modifiers.list.call(self, spec, owner, msg, list)
            }

            explain && (expdata.list_len = list ? list.length : 0)

            return intern.reply(self, reply, list, explain, expdata)
          })
        }

        // handle remove operation
        else if ('remove' === msg.cmd) {
          explain && (expdata.path = 'remove')

          refine_query(self, msg, queryprop, spec, owner, intern, resolvedFieldNames)
          explain && (expdata.query = msg[queryprop])

          self.make(msg.ent.entity$).list$(msg.q, function(err: any, list: any) {
            if (err) return self.fail(err)

            if (modifiers.list) {
              explain &&
                ((expdata.modifiers.list = true),
                  (expdata.orig_list_len = list ? list.length : 0))
              list = modifiers.list.call(self, spec, owner, msg, list)
            }

            // TODO: should use list result ids!!!
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
            refine_query(self, msg, queryprop, spec, owner, intern, resolvedFieldNames)
            explain && (expdata.query = msg[queryprop])
          }

          self.prior(msg, function(err: any, load_ent: any) {
            if (err) return reply(err)
            if (null == load_ent) return reply()

            // was not an id-based query, so refinement already made
            if (null == msg[queryprop].id) {
              explain && ((expdata.query_load = true), (expdata.ent = load_ent))

              return intern.reply(self, reply, load_ent, explain, expdata)
            }

            if (modifiers.entity) {
              explain && (expdata.modifiers.entity = true)

              spec = modifiers.entity.call(self, spec, owner, msg, load_ent)
              explain && (expdata.modifiers.entity_spec = spec)
            }

            let pass = true
            for (let fieldI = 0; fieldI < spec.fields.length; fieldI++) {
              const fieldName = spec.fields[fieldI]
              const [ownerFieldName, entityFieldName] =
                (resolvedFieldNames[fieldName] ||
                  (resolvedFieldNames[fieldName] =
                    intern.resolveFieldNames(spec.fields[fieldI])))

              // need this field to match owner for ent to be readable
              // if (spec.read[f]) {
              if (spec.read[fieldName]) {
                pass = pass && intern.match(owner[ownerFieldName], load_ent[entityFieldName])

                if (!pass) {
                  explain &&
                    (expdata.field_match_fail = {
                      field: spec.fields[fieldI],
                      ownerFieldName,
                      entityFieldName,
                      ent_val: load_ent[entityFieldName],
                      owner_val: owner[ownerFieldName]
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

          const ent = msg[entprop]

          // console.log('OWNER save A', ent, spec)

          // only set fields props if not already set
          for (let fieldI = 0; fieldI < spec.fields.length; fieldI++) {
            const fieldName = spec.fields[fieldI]
            const [ownerFieldName, entityFieldName] =
              (resolvedFieldNames[fieldName] ||
                (resolvedFieldNames[fieldName] =
                  intern.resolveFieldNames(spec.fields[fieldI])))

            // const f = spec.fields[i]
            if (
              spec.inject[fieldName] &&
              null == ent[entityFieldName] &&
              null != owner[ownerFieldName]
            ) {
              ent[entityFieldName] =
                Array.isArray(owner[ownerFieldName]) ?
                  owner[ownerFieldName][0] : owner[ownerFieldName]
            }
          }

          // creating
          if (null == ent.id) {
            explain && (expdata.path = 'save/create')

            for (let fieldI = 0; fieldI < spec.fields.length; fieldI++) {
              const fieldName = spec.fields[fieldI]
              const [ownerFieldName, entityFieldName] =
                (resolvedFieldNames[fieldName] ||
                  (resolvedFieldNames[fieldName] =
                    intern.resolveFieldNames(spec.fields[fieldI])))

              // console.log('CREATE', fieldName, ownerFieldName, entityFieldName, ent, spec)

              if (spec.write[fieldName] && null != ent[entityFieldName]) {
                if (!intern.match(owner[ownerFieldName], ent[entityFieldName])) {
                  const fail = {
                    code: 'create-not-allowed',
                    details: {
                      why: 'field-mismatch-on-create',
                      field: fieldName,
                      ownerFieldName,
                      entityFieldName,
                      ent_val: ent[entityFieldName],
                      owner_val: owner[ownerFieldName]
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

            let fail: any

            // TODO: seneca entity update would really help there!
            self.make(ent.entity$).load$(ent.id, function(this: any, err: any, oldent: any) {
              if (err) return this.fail(err)
              if (null == oldent) {
                fail = {
                  code: 'save-not-found',
                  details: { entity: ent.entity$, id: ent.id }
                }

                explain && (expdata.fail = fail)
                return intern.fail(self, reply, fail, explain, expdata)
              }

              for (let fieldI = 0; fieldI < spec.fields.length; fieldI++) {
                const fieldName = spec.fields[fieldI]
                const [ownerFieldName, entityFieldName] =
                  (resolvedFieldNames[fieldName] ||
                    (resolvedFieldNames[fieldName] =
                      intern.resolveFieldNames(spec.fields[fieldI])))

                if (
                  spec.write[fieldName] &&
                  !spec.alter[fieldName] &&
                  oldent[entityFieldName] !== ent[entityFieldName]
                ) {
                  fail = {
                    code: 'update-not-allowed',
                    details: {
                      why: 'field-mismatch-on-update',
                      field: fieldName,
                      ownerFieldName,
                      entityFieldName,
                      oldent_val: oldent[entityFieldName],
                      ent_val: ent[entityFieldName]
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

    checkOwner.desc = 'Validate owner for ' + seneca.util.pattern(msgpat)

    // seneca.add(msgpat, owner)
    seneca.wrap(msgpat, checkOwner)

    //if (!seneca.find(msgpat, { exact: true })) {
    seneca.add(msgpat, checkOwner)
    // }
  })

  return {
    exports: {
      make_spec: (inspec: any) => intern.make_spec(inspec, default_spec),
      casemap: casemap,
      config: {
        spec: default_spec,
        options: options
      }
    }
  }
}

const intern = (Owner.intern = {
  // default_spec: null,
  deepextend: (a: any, b: any, c: any) => null,

  make_spec: function(inspec: any, default_spec: any) {
    const spec: any = intern.deepextend({}, default_spec, inspec)
    spec.fields = [...new Set(spec.fields)]
      ;['write', 'read', 'inject', 'alter'].forEach(m => {
        spec[m] = spec[m] || {}
      })

    spec.fields.forEach(function(f: any) {
      spec.write[f] = null == spec.write[f] ? true : spec.write[f]
      spec.read[f] = null == spec.read[f] ? true : spec.read[f]
      spec.inject[f] = null == spec.inject[f] ? true : spec.inject[f]
    })
      ;['write', 'read', 'inject', 'alter'].forEach(m => {
        spec.fields = [...new Set(spec.fields.concat(Object.keys(spec[m])))]
      })

    spec.public = spec.public || {}
    spec.public.read = spec.public.read || {}

    return spec
  },


  match: function(matching_val: any, check_val: any) {
    // match if check_val (from ent) is undefined (thus not considered), or
    // if check_val (from ent) equals one of the valid matching vals
    return (
      void 0 === check_val ||
      (Array.isArray(matching_val) && matching_val.includes(check_val)) ||
      check_val === matching_val
    )
  },

  prior: function(self: any, msg: any, reply: any, explain: any, expdata: any) {
    explain && explain(expdata)
    return self.prior(msg, reply)
  },

  reply: function(self: any, reply: any, result: any, explain: any, expdata: any) {
    explain && explain(expdata)
    return reply(result)
  },

  fail: function(self: any, reply: any, fail: any, explain: any, expdata: any) {
    explain && explain(expdata)
    return reply(self.error(fail.code, fail.details))
  },

  resolveFieldNames: (fieldName: string) => {
    const parts = fieldName.split(':')
    const resolvedNames = [parts[0], null == parts[1] ? parts[0] : parts[1]]
    // console.log('resolvedNames', fieldName, resolvedNames)
    return resolvedNames
  }
})

// get dot path property
const getprop = (o: any, p: string, _?: any): any =>
(_ = ('' + p).match(/^([^\.]+)\.(.*)$/), ((null != o && null != _) ?
  getprop(o[_[1]], _[2]) : (null == o ? o : o[p])))



Object.assign(Owner, { defaults, intern })

// Prevent name mangling
Object.defineProperty(Owner, 'name', { value: 'Owner' })

export default Owner

if ('undefined' !== typeof module) {
  module.exports = Owner
}
