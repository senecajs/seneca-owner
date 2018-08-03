/* Copyright (c) 2018 voxgig and other contributors, MIT License */
'use strict'

const Optioner = require('optioner')

const Joi = Optioner.Joi

const optioner = Optioner({
  entprop: Joi.string().default('ent'),
  annotate: Joi.array().required(),
  allowprop: Joi.string().default('allow')
})

module.exports = function owner(options) {
  const seneca = this
  const opts = optioner.check(options)
  const allowprop = opts.allowprop
  const entprop = opts.entprop

  opts.annotate.forEach(function(msgpat) {
    seneca.add(msgpat, function(msg, reply, meta) {
      var usrdata = meta.custom[allowprop]

      var ent = msg[entprop]
      // TODO: make these props configurable too
      if (usrdata.usr) {
        ent.usr = usrdata.usr
      }
      if (usrdata.org) {
        ent.org = usrdata.org
      }

      this.prior(msg, reply)
    })
  })
}

const intern = (module.exports.intern = {})
