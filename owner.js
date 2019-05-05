/* Copyright (c) 2018-2019 voxgig and other contributors, MIT License */
'use strict'

/*

NEXT: 
- allow any combination of user or org
- support update operations
- leave existing owner prop alone
- better flags via fixed meta.custom
- seneca - allow per plugin setting of flags - make_act_delegate
  - amend actdef after plugin def returns to add fixed args + meta
  - demonstrate get of out jail possible

*/

const Joi = require('joi')

module.exports = owner
module.exports.defaults = {
  default_spec: Joi.object().default({
    active: true,
    fields: [],
    read: { // default true
      //usr: true,
      //org: true
    },
    write: { // default true
      //usr: true,
      //org: true
    },
    inject: { // default true
      //usr: true,
      //org: true
    },
    alter: { // default false
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
  fields: Joi.array().default([])
}


function owner(options) {
  const seneca = this

  intern.deepextend = seneca.util.deepextend

  options.default_spec.fields = [...new Set(options.default_spec.fields.concat(options.fields))]
  intern.default_spec = intern.make_spec(options.default_spec)

  const casemap = {}

  this
    .fix('sys:owner')
    .add('hook:case', hook_case)


  // TODO: allow multiple ordered cases
  function hook_case(msg, reply) {
    var kase = msg.case
    var modifiers = msg.modifiers

    if('string' === typeof(kase) && 'object' === typeof(modifiers)) {
      casemap[kase] = modifiers
    }
    
    reply()
  }
  
  
  const specP = options.specprop
  const ownerprop = options.ownerprop
  const caseP = options.caseprop
  const ownerent = options.ownerent
  const entprop = options.entprop
  const queryprop = options.queryprop
  const usrprop = options.usrprop
  const orgprop = options.orgprop
  const usrref = options.usrref
  const orgref = options.orgref
  const entity = !!options.entity


  const annotate = options.annotate.map(p => seneca.util.Jsonic(p))

  
  // TODO: should do a seneca.find and annotate those
  annotate.forEach(function(msgpat) {
    var owner = function owner(msg, reply, meta) {
      var self = this
      
      var spec = self.util.deepextend(meta.custom[specP] || intern.default_spec)
      var owner = meta.custom[ownerprop]

      var modifiers = {}
      if(owner && casemap[owner[caseP]]) {
        //spec = casemap[owner[caseP]](self.util.deepextend(spec),owner,msg)
        //if(null == spec) return self.fail('no-spec', {case:caseP})

        modifiers = casemap[owner[caseP]]
      }

      if(modifiers.query) {
        spec = modifiers.query(spec,owner,msg)
      }
      

      
      // console.log('MSG', msg)
      // console.log('SPEC', spec)
      // console.log('OWNER', owner)
      // console.log('CASEMAP', casemap)

      
      if (spec.active) {
        if ('list' === msg.cmd || 'remove' === msg.cmd ) {
          intern.refine_query(self,msg,queryprop,spec,owner)          
          return self.prior(msg, reply)
        }
        else if ('load' === msg.cmd ) {
          // only change query if not loading by id - preserves caching!
          if(null == msg[queryprop].id) {
            intern.refine_query(self,msg,queryprop,spec,owner)
          }

          self.prior(msg, function(err, out) {
            console.log('LOAD PRIOR', err, out)
            
            if(err) return reply(err)
            if(null == out) return reply()

            // was not an id-based query, so refinement already made
            if(null == msg[queryprop].id) return reply(out)

            if(modifiers.entity) {
              spec = modifiers.entity(spec,owner,msg,out)
            }

            var pass = true
            spec.fields.forEach(function(f){
              // need this field to match owner for ent to be readable
              if(spec.read[f]) {
                pass = pass && (
                  (Array.isArray(owner[f]) && owner[f].includes(out[f])) ||
                    out[f] === owner[f] )
              }
            })

            console.log('PASS', pass, spec, owner, out)
            
            reply(pass ? out : null)
          })
        }
        else if('save' === msg.cmd ) {
          var ent = msg[entprop]

          // console.log('SAVE A', ent)
          
          // only set fields props if not already set
          spec.fields.forEach(f=>{
            // console.log('SAVE FIELD', f, spec.inject[f], ent[f], owner[f])
            if (spec.inject[f] && null == ent[f] && null != owner[f]) {
              ent[f] = Array.isArray(owner[f]) ? owner[f][0] : owner[f] 
            }
          })

          // console.log('SAVE B', spec.fields, ent)
          
          // creating
          if(null == ent.id) {

            spec.fields.forEach(f=>{
              if(spec.write[f] && null != ent[f]) {
/*
                console.log('SAVE CREATE',
                            f,
                            owner[f],
                            Array.isArray(owner[f]) && !owner[f].includes(ent[f]),
                            ent[f] !== owner[f]
                           )
*/
                
                if( (Array.isArray(owner[f]) && !owner[f].includes(ent[f]))
                    && ent[f] !== owner[f] ) {
                  self.fail('create-not-allowed', {
                    why:'field-mismatch-on-create',
                    field:f,
                    ent_val:ent[f],
                    owner_val:owner[f]
                  })
                }
              }
            })

            console.log('SAVE CREATE PRIOR')
            return self.prior(msg, reply)
          }

          // updating
          else {
            // TODO: seneca entity update would really help there!
            self.make(ent.entity$).load$(ent.id, function(err, oldent) {
              console.log('SAVE UPDATE LOAD +++++++++', ent.id, msg.q, oldent)

              if(err) return this.fail(err)
              if(null == oldent) return self.fail('save-not-found',
                                                  {entity:ent.entity$,id:ent.id})
              

              spec.fields.forEach(f=>{
                //if (spec.write[f] && (oldent[f] !== owner[f])) {
                if (spec.write[f] && (oldent[f] !== ent[f])) {
                  self.fail('update-not-allowed', {
                    why:'field-mismatch-on-update',
                    field:f,
                    oldent_val:oldent[f],
                    //owner_val:owner[f]
                    ent_val:ent[f]
                  })
                }

                // only change field if alter allowed
                if ( !(spec.alter[f] &&
                       ((Array.isArray(owner[f]) && owner[f].includes[ent[f]] ) ||
                        ent[f] === owner[f]
                       )) ) {

                  // ent[f] = owner[f]
                  //}
                  //else {

                  // reset to existing value
                  ent[f] = oldent[f]
                }
              })

              console.log('SAVE UPDATE PRIOR')
              return self.prior(msg, reply)
            })
          }
        }
      }
      else {
        return self.prior(msg, reply)
      }
    }

    owner.desc = 'Validate owner for '+seneca.util.pattern(msgpat)
    
    seneca.add(msgpat, owner)
  })

  return {
    exports: {
      make_spec: intern.make_spec
    }
  }
}

const intern = owner.intern = {
  default_spec: null,
  deepextend: null,

  make_spec: function(inspec) {
    const spec = intern.deepextend({}, intern.default_spec, inspec)
    spec.fields = [...new Set(spec.fields)]

    ;['write','read','inject','alter'].forEach(m => {
      spec[m] = spec[m] || {}
    })
    
    spec.fields.forEach(function(f) {
      spec.write[f] = null == spec.write[f] ? true : spec.write[f]
      spec.read[f] = null == spec.read[f] ? true : spec.read[f]
      spec.inject[f] = null == spec.inject[f] ? true : spec.inject[f]
    })

    ;['write','read','inject','alter'].forEach(m => {
      spec.fields = [...new Set(spec.fields.concat(Object.keys(spec[m])))]
    })

    // console.log('SPEC', spec)
    
    return spec
  },

  refine_query: function(seneca,msg,queryprop,spec,owner) {
    msg[queryprop] = msg[queryprop] || {}
    spec.fields.forEach(function(f){
      if (spec.read[f]) {
        if(Array.isArray(owner[f])) {
          if( null == msg[queryprop][f]) {
            msg[queryprop][f] = owner[f][0]
          }
          else if(!owner[f].includes(msg[queryprop][f])) {
            seneca.fail('field-not-valid', {
              field:f,
              query_val:msg[queryprop][f],
              valid_owner_vals:owner[f]
            })
          }
        }
        else {
          msg[queryprop][f] = owner[f]
        }

        // remove from query if value is null
        if(null == msg[queryprop][f]) {
          delete msg[queryprop][f]
        }
      }
    })

    console.log('RQ', msg[queryprop])
  }
}
