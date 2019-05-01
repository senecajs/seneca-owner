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
    write: {
      usr: true,
      org: true
    }
  }),
  
  specprop: Joi.string().default('sys-owner-spec'),
  ownerprop: Joi.string().default('sys-owner'),
  
  entprop: Joi.string().default('ent'),
  qprop: Joi.string().default('q'),


  // on the ent
  usrprop: Joi.string().default('usr'),
  orgprop: Joi.string().default('org'),

  // on the owner meta data
  usrref: Joi.string().default('usr'),
  orgref: Joi.string().default('org'),

  // owner props (usr, org) are entities, resolve with owner[usrprop].id
  ownerent: Joi.boolean().default(false),

  annotate: Joi.array().required(),

  msg_flag: Joi.string().default(null),

  org_only_flag: Joi.string().default(null)
}


function owner(options) {
  const seneca = this

  intern.deepextend = seneca.util.deepextend
  intern.default_spec = options.default_spec
  
  const specP = options.specprop
  const ownerprop = options.ownerprop
  const ownerent = options.ownerent
  const entprop = options.entprop
  const qprop = options.qprop
  const usrprop = options.usrprop
  const orgprop = options.orgprop
  const usrref = options.usrref
  const orgref = options.orgref
  const entity = !!options.entity
  const msg_flag = options.msg_flag
  const org_only_flag = options.org_only_flag

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

  annotate.forEach(function(msgpat) {
    seneca.add(msgpat, function(msg, reply, meta) {
      var spec = meta.custom[specP] || options.default_spec
      var owner = meta.custom[ownerprop]

      var valid_msg = msg_flag ? msg[msg_flag] : true

      console.log('SPEC', spec, meta.custom)
      
      var org_only = org_only_flag ? msg[org_only_flag] : false
      if (owner && valid_msg) {
        var usr_id = !!ownerent
          ? owner[usrref] && owner[usrref].id
          : owner[usrref]

        var org_id = !!ownerent
          ? owner[orgref] && owner[orgref].id
          : owner[orgref]

        if ('list' === msg.cmd) {
          var q = msg[qprop]
          if (!org_only && !q[usrprop] && usr_id) {
            q[usrprop] = usr_id
          }
          if (!q[orgprop] && org_id) {
            q[orgprop] = org_id
          }
        } else if('save' === msg.cmd) {
          var ent = msg[entprop]

          if (spec.write.usr && !ent[usrprop] && usr_id) {
            ent[usrprop] = usr_id
          }
          if (spec.write.org && !ent[orgprop] && org_id) {
            ent[orgprop] = org_id
          }

        } else {
          var ent = msg[entprop]
          if (!org_only && !ent[usrprop] && usr_id) {
            ent[usrprop] = usr_id
          }
          if (!ent[orgprop] && owner[orgref]) {
            ent[orgprop] = org_id
          }
        }
      }

      this.prior(msg, reply)
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
  make_spec: function(spec) {
    return intern.deepextend({}, intern.default_spec, spec)
  }
}
