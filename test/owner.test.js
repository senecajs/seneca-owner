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
      this.make('bar', { who: msg.who }).save$(reply)
    })
    .use('..', {
      annotate: ['role:entity,base:core']
    })
    .ready(function() {
      this.act(
        'role:foo,add:bar,who:zed',
        { user: { id: 'u0', org: 'o0' } },
        function(err, out) {
          expect(out.who).equal('zed')
          expect(out.user).equal('u0')
          expect(out.org).equal('o0')
          fin()
        }
      )
    })
})
