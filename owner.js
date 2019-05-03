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

  // on the ent
  usrprop: Joi.string().default('usr'),
  orgprop: Joi.string().default('org'),

  // on the owner meta data
  usrref: Joi.string().default('usr'),
  orgref: Joi.string().default('org'),
  
  annotate: Joi.array().required()
}


function owner(options) {
  const seneca = this

  intern.deepextend = seneca.util.deepextend
  intern.default_spec = intern.make_spec(options.default_spec)

  const casemap = {}

  this
    .fix('sys:owner')
    .add('hook:case', hook_case)

  function hook_case(msg, reply) {
    var kase = msg.case
    var modifier = msg.modifier

    if('string' === typeof(kase) && 'function' === typeof(modifier)) {
      casemap[kase] = modifier
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
    seneca.add(msgpat, function(msg, reply, meta) {
      var self = this
      
      var spec = meta.custom[specP] || options.default_spec
      var owner = meta.custom[ownerprop]

      if(owner && casemap[owner[caseP]]) {
        spec = casemap[owner[caseP]](self.util.deepextend(spec),owner)
        if(null == spec) return self.fail('no-spec', {case:caseP})
      }

      /*
      console.log('MSG', msg)
      console.log('SPEC', spec)
      console.log('OWNER', owner)
      */
      
      if (spec.active) {
        //var usr_id = owner.usr
        //var org_id = owner.org
        
        if ('list' === msg.cmd || 'remove' === msg.cmd ) {
          intern.refine_query(msg,queryprop,spec,owner)          
          return self.prior(msg, reply)
        }
        else if ('load' === msg.cmd ) {
          // only change query if not loading by id - preserves caching!
          if(null == msg[queryprop].id) {
            intern.refine_query(msg,queryprop,spec,owner)
          }

          self.prior(msg, function(err, out) {
            //console.log('LOAD PRIOR', err, out)
            
            if(err) return reply(err)
            if(null == out) return reply()

            // was not an id-based query, so refinement already made
            if(null == msg[queryprop].id) return reply(out)

            var pass = true
            spec.fields.forEach(function(f){
              // need this field to match owner for ent to be readable
              if(spec.read[f]) {
                pass = pass && (out[f] === owner[f])
              }
            })

            // console.log('PASS', pass, spec, owner)
            
            reply(pass ? out : null)
          })
        }
        else if('save' === msg.cmd ) {
          var ent = msg[entprop]

          // only set fields props if not already set
          spec.fields.forEach(f=>{
            if (spec.inject[f] && null == ent[f] && null != owner[f]) {
              ent[f] = owner[f]
            }
          })
          
          // creating
          if(null == ent.id) {

            spec.fields.forEach(f=>{
              if(spec.write[f] && ent[f] !== owner[f] && null != ent[f] ) {
                self.fail('create-not-allowed', {
                  why:'field-mismatch-on-create',
                  field:f,
                  ent_val:ent[f],
                  owner_val:owner[f]
                })
              }
            })

            return self.prior(msg, reply)
          }

          // updating
          else {
            // TODO: seneca entity update would really help there!
            self.make(ent.entity$).load$(ent.id, function(err, oldent) {
              if(err) return this.fail(err)
              if(null == oldent) return this.fail('save-not-found',
                                                  {entity:ent.entity$,id:ent.id})
              

              spec.fields.forEach(f=>{
                if (spec.write[f] && oldent[f] !== owner[f]) {
                  self.fail('update-not-allowed', {
                    why:'field-mismatch-on-update',
                    field:f,
                    oldent_val:oldent[f],
                    owner_val:owner[f]
                  })
                }

                // only change field if alter allowed
                if (spec.alter[f] && null != owner[f]) {
                  ent[f] = owner[f]
                }
                else {
                  ent[f] = oldent[f]
                }
              })
              
              return self.prior(msg, reply)
            })
          }
        }
      }
      else {
        return self.prior(msg, reply)
      }
    })
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
    spec.fields = [...new Set(spec.fields.concat(['usr','org']))]

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

  refine_query: function(msg,queryprop,spec,owner) {
    msg[queryprop] = msg[queryprop] || {}
    spec.fields.forEach(function(f){
      if (spec.read[f]) {
        msg[queryprop][f] = owner[f]
      }
    })
  }
}
