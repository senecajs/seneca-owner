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
    fields: ['usr','org'],
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
  caseprop: Joi.string().default('case'),
  
  entprop: Joi.string().default('ent'),
  qprop: Joi.string().default('q'),


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
  const qprop = options.qprop
  const usrprop = options.usrprop
  const orgprop = options.orgprop
  const usrref = options.usrref
  const orgref = options.orgref
  const entity = !!options.entity


  const annotate = []
  options.annotate.forEach(function(msgpat) {
    const msgpatobj =
      'string' === typeof msgpat ? seneca.util.Jsonic(msgpat) : msgpat
    if (entity) {
      ;['save', 'load', 'list', 'remove'].forEach(function(cmd) {
        annotate.push(Object.assign({ role: 'entity', cmd: cmd }, msgpatobj))
      })
    } else {
      annotate.push(msgpatobj)
    }
  })

  // TODO: should do a seneca.find and annotate those
  annotate.forEach(function(msgpat) {
    seneca.add(msgpat, function(msg, reply, meta) {
      var self = this
      
      var spec = meta.custom[specP] || options.default_spec
      var owner = meta.custom[ownerprop]

      if(owner && casemap[owner[caseP]]) {
        spec = casemap[owner[caseP]](self.util.deepextend(spec),owner)
      }

      /*
      console.log('MSG', msg)
      console.log('SPEC', spec)
      console.log('OWNER', owner)
      */
      
      if (spec.active) {
        var usr_id = owner.usr
        var org_id = owner.org
        
        if ('list' === msg.cmd || 'load' === msg.cmd || 'remove' === msg.cmd ) {
          intern.refine_query(msg[qprop],spec,owner)          
          return self.prior(msg, reply)
        }
        else if ('load' === msg.cmd ) {
          // only change query if not loading by id - preserves caching!
          if(null == msg[qprop].id) {
            intern.refine_query(msg[qprop],spec,owner)
          }

          return self.prior(msg, function(err, out) {
            reply(err || (
              null == out ? null : (
                null == msg[qprop].id ? out : (
                  ((spec.read.usr && (out[usrprop] === usr_id)) &&
                   (spec.read.org && (out[orgprop] === org_id)))
                    ? out : null 
                )
              )
            ))
          })
        }
        else if('save' === msg.cmd ) {
          var ent = msg[entprop]

          // only set usr and org props if not already set
          if (spec.inject.usr && !ent[usrprop] && usr_id) {
            ent[usrprop] = usr_id
          }
          if (spec.inject.org && !ent[orgprop] && org_id) {
            ent[orgprop] = org_id
          }

          // creating
          if(null == ent.id) {
            if(spec.write.usr && ent[usrprop] !== usr_id && null != ent[usrprop] ) {
              self.fail('create-not-allowed', {why:'not-usr'})
            }

            if(spec.write.org && ent[orgprop] !== org_id && null != ent[orgprop] ) {
              self.fail('create-not-allowed', {why:'not-org'})
            }

            return self.prior(msg, reply)
          }

          // updating
          else {
            // TODO: seneca entity update would really help there!
            self.make(ent.entity$).load$(ent.id, function(err, oldent) {
              if(err) return this.fail(err)
              if(null == oldent) return this.fail('save-not-found',
                                                  {entity:ent.entity$,id:ent.id})
              
              if (spec.write.usr && oldent[usrprop] !== usr_id) {
                self.fail('update-not-allowed', {why:'not-usr'})
              }
            
              if (spec.write.org && oldent[orgprop] !== org_id) {
                self.fail('update-not-allowed', {why:'not-org'})
              }

              if (spec.alter.usr && usr_id) {
                ent[usrprop] = usr_id
              }
              else {
                ent[usrprop] = oldent[usrprop]
              }

              if (spec.alter.org && org_id) {
                ent[orgprop] = org_id
              }
              else {
                ent[orgprop] = oldent[orgprop]
              }

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
    spec.fields.forEach(function(f) {
      spec.write[f] = null == spec.write[f] ? true : spec.write[f]
      spec.read[f] = null == spec.read[f] ? true : spec.read[f]
      spec.inject[f] = null == spec.inject[f] ? true : spec.inject[f]
    })
    return spec
  },

  refine_query: function(q,spec,owner) {
    spec.fields.forEach(function(f){
      if (spec.read[f]) {
        q[f] = owner[f]
      }
    })
  }
}
