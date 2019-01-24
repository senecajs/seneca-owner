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
        owner: {
          usr: 'alice',
          org: 'wonderland'
        }
      }
    })
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).equal('wonderland')
        fin()
      })
    })
})


lab.test('customprops', fin => {
  Seneca()
    .test(fin)
    .use('entity')
    .add('role:foo,add:bar', function(msg, reply) {
      this.make('core/act').save$(reply)
    })
    .use('..', {
      usrprop: 'user_id',
      orgprop: 'org_id',
      usrref: 'user',
      orgref: 'org',
      ownerprop: 'principal',
      ownerent: true,
      annotate: ['role:entity,cmd:save,base:core']
    })
    .delegate(null, {
      custom: {
        principal: {
          user: {id:'alice'},
          org: {id:'wonderland'}
        }
      }
    })
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.user_id).equal('alice')
        expect(out.org_id).equal('wonderland')
        fin()
      })
    })
})



lab.test('empty-owner', fin => {  
  Seneca()
    .test(fin)
    .use('entity')
    .add('role:foo,add:bar', function(msg, reply) {
      this.make('core/act').save$(reply)
    })
    .use('..', {
      entity: true,
      annotate: ['base:core']
    })
    .delegate(null, {
      custom: {
        owner: {}
      }
    })
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal(undefined)
        expect(out.org).equal(undefined)
        fin()
      })
    })
})

lab.test('multiple-actions', fin => {  
  Seneca()
    .test(fin)
    .use('entity')
    .add('role:foo,add:bar', function(msg, reply) {
      this.make('core/act', { usr: msg.usr, org: msg.org }).save$(reply)
    })
    .add('role:foo,query:foo', function(msg, reply) {
      this.make('core/act').list$(reply)
    })
    .add('role:foo,query:bar', function(msg, reply) {
      this.make('core/act').list$({ usr: 'john', org: 'john' }, reply)
    })
    .use('..', {
      entity: true,
      annotate: [{base:'core'}]
    })
    .delegate(null, {
      custom: {
        owner: {
          usr: 'alice',
          org: 'wonderland'
        }
      }
    })
    .ready(function() {
      this.act('role:foo,add:bar', { usr: 'john', org: 'john' }, function(
        err,
        out
      ) {
        expect(out.usr).equal('john')
        expect(out.org).equal('john')
      })
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).equal('wonderland')
      })
      this.act('role:foo,query:foo', function(err, query_out) {
        expect(query_out.length).equal(1)

        var query_out_data = query_out[0]
        expect(query_out_data.usr).equal('alice')
        expect(query_out_data.org).equal('wonderland')
      })
      this.act('role:foo,query:bar', function(err, query_out) {
        expect(query_out.length).equal(1)

        var query_out_data = query_out[0]
        expect(query_out_data.usr).equal('john')
        expect(query_out_data.org).equal('john')
      })
    })

  Seneca()
    .test(fin)
    .use('entity')
    .add('role:foo,add:bar', function(msg, reply) {
      this.make('core/act').save$(reply)
    })
    .use('..', {
      annotate: ['role:entity,cmd:save,base:core']
    })
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal(undefined)
        fin()
      })
    })
})
