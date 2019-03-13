/* Copyright (c) 2018 voxgig and other contributors, MIT License */
'use strict'

const Optioner = require('optioner')

const Joi = Optioner.Joi

const optioner = Optioner({
  entprop: Joi.string().default('ent'),
  qprop: Joi.string().default('q'),
  ownerprop: Joi.string().default('owner'),

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
})

module.exports = function owner(options) {
  const seneca = this
  const opts = optioner.check(options)

  const ownerprop = opts.ownerprop
  const ownerent = opts.ownerent
  const entprop = opts.entprop
  const qprop = opts.qprop
  const usrprop = opts.usrprop
  const orgprop = opts.orgprop
  const usrref = opts.usrref
  const orgref = opts.orgref
  const entity = !!opts.entity
  const msg_flag = opts.msg_flag
  const org_only_flag = opts.org_only_flag

  const annotate = []
  opts.annotate.forEach(function(msgpat) {
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
      var owner = meta.custom[ownerprop]
      var valid_msg = msg_flag ? msg[msg_flag] : true
      var org_only = org_only_flag ? msg[org_only_flag] : false
      if (owner && valid_msg) {
        var usr_id = !!ownerent
          ? owner[usrref] && owner[usrref].id
          : owner[usrref]

        var org_id = !!ownerent
          ? owner[orgref] && owner[orgref].id
          : owner[orgref]

        if (msg.cmd === 'list') {
          var q = msg[qprop]
          if (!org_only && !q[usrprop] && usr_id) {
            q[usrprop] = usr_id
          }
          if (!q[orgprop] && owner[orgref]) {
            q[orgprop] = org_id
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
}

const intern = (module.exports.intern = {})
