/* Copyright (c) 2018 voxgig and other contributors, MIT License */
'use strict'

const Optioner = require('optioner')

const Joi = Optioner.Joi

const optioner = Optioner({
  userprop: Joi.string().default('user'),
  entprop: Joi.string().default('ent'),
  inbound: Joi.array().required(),
  annotate: Joi.array().required()
})

module.exports = function owner(options) {
  const seneca = this
  const opts = optioner.check(options)
  const userprop = opts.userprop
  const entprop = opts.entprop

  // console.log(userprop, entprop)

  opts.annotate.forEach(function(msgpat) {
    seneca.add(msgpat, function(msg, reply, meta) {
      var userdata = msg[userprop]
      var ent = msg[entprop]

      // TODO: make these props configurable too
      const principal = meta.custom.allow
      ent.user = principal.user
      ent.org = principal.org

      this.prior(msg, reply)
    })
  })
}

const intern = (module.exports.intern = {})
