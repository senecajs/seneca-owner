/* Copyright (c) 2018 voxgig and other contributors, MIT License */
'use strict'

const Optioner = require('optioner')

const Joi = Optioner.Joi

const optioner = Optioner({
  entprop: Joi.string().default('ent'),
  qprop: Joi.string().default('q'),
  annotate: Joi.array().required(),
  allowprop: Joi.string().default('allow')
})

module.exports = function owner(options) {
  const seneca = this
  const opts = optioner.check(options)
  const allowprop = opts.allowprop
  const entprop = opts.entprop
  const qprop = opts.qprop

  opts.annotate.forEach(function(msgpat) {
    seneca.add(msgpat, function(msg, reply, meta) {
      var usrdata = meta.custom[allowprop]

      if (usrdata) {
        if (msg.cmd === 'list') {
          var q = msg[qprop]
          if (!q.usr && usrdata.usr) {
            q.usr = usrdata.usr
          }
          if (!q.org && usrdata.org) {
            q.org = usrdata.org
          }
        } else {
          var ent = msg[entprop]
          if (!ent.usr && usrdata.usr) {
            ent.usr = usrdata.usr
          }
          if (!ent.org && usrdata.org) {
            ent.org = usrdata.org
          }
        }
      }

      this.prior(msg, reply)
    })
  })
}

const intern = (module.exports.intern = {})
