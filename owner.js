/* Copyright (c) 2018 voxgig and other contributors, MIT License */
'use strict'

const Optioner = require('optioner')

const Joi = Optioner.Joi

const optioner = Optioner({
  userprop: Joi.string().default('user'),
  entprop: Joi.string().default('ent'),
  inbound: Joi.array().required(),
  annotate: Joi.array().required(),
})

module.exports = function owner(options) {
  const seneca = this
  const opts = optioner.check(options)
  const userprop = opts.userprop
  const entprop = opts.entprop

  // console.log(userprop, entprop)
  
  opts.inbound.forEach(function(msgpat) {
    seneca.wrap(msgpat, function(msg, reply) {
      // TODO: error if userprop not found: configurable
      var userdata = msg[userprop]

      
      // TODO: fixedargs should be renamed
      this.fixedargs[userprop] = userdata

      this.prior(msg, reply)
    })
  })

  opts.annotate.forEach(function(msgpat) {
    seneca.add(msgpat, function(msg, reply) {
      var userdata = msg[userprop]
      var ent = msg[entprop]

      // TODO: make these props configurable too
      ent.user = userdata.id
      ent.org = userdata.org

      this.prior(msg, reply)
    })
  })
}

const intern = (module.exports.intern = {
})
