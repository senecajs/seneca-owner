/* Copyright (c) 2018 voxgig and other contributors, MIT License */
'use strict'

const Util = require('util')

const Lab = require('lab')
const Code = require('code')
const lab = (exports.lab = Lab.script())
const expect = Code.expect

const PluginValidator = require('seneca-plugin-validator')
const Seneca = require('seneca')
const Plugin = require('..')

lab.test('validate', PluginValidator(Plugin, module))

lab.test('happy', fin => {
  Seneca()
    .test(fin)
    .use('entity')
    .add('role:foo,add:bar', function(msg, reply) {
      this.make('core/act').save$(reply)
    })
    .use('..', {
      annotate: ['role:entity,cmd:save,base:core']
    })
    .delegate(null, {
      custom: {
        allow: {
          usr: 'alice',
          org: 'alice'
        }
      }
    })
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).equal('alice')
        fin()
      })
    })
})
