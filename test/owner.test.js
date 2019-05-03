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

function make_bar_instance(fin,spec) {
  spec = spec || {}
  return Seneca({legacy:{transport:false}})
    .test(fin)
    .use('entity')
    .use(Plugin, {
      annotate: [
        'role:entity,cmd:save,base:core',
        'role:entity,cmd:load,base:core',
        'role:entity,cmd:list,base:core',
        'role:entity,cmd:remove,base:core',
      ]
    })
    .ready(function() {
      var make_spec = this.export('owner/make_spec')
      var full_spec = make_spec(spec)

      this.act('sys:owner,hook:case,case:admin',{
        modifier: function(spec, owner) {
          if('cathy' === owner.usr) {
            spec.read.usr = false
            spec.write.usr = false
          }
          return spec
        }
      })
      
      this
        .add(
          'role:foo,add:bar',
          {custom$:{'sys-owner-spec':full_spec}},
          function(msg, reply) {
            this.make('core/bar',Object.assign({x:Math.random()},msg.data))
              .save$(reply)
          })

      this
        .fix('role:foo',null,{'sys-owner-spec':full_spec})
        .add(
          'load:bar',
          function(msg, reply) {
            this.make('core/bar').load$(msg.id, reply)
          })
        .add(
          'update:bar',
          function(msg, reply) {
            this.make('core/bar').load$(msg.id, function(err, out) {
              if(err) return;
              out.data$(msg.data).save$(reply)
            })
          })
    })
    .delegate(null, {
      custom: {
        'sys-owner': {
          usr: 'alice',
          org: 'wonderland'
        }
      }
    })
}

lab.test('happy', fin => {
  make_bar_instance(fin)
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).equal('wonderland')
        fin()
      })
    })
})

lab.test('spec-inject-no-org', fin => {
  var spec = {inject:{org:false}}
  make_bar_instance(fin,spec)
    .ready(function() {      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).not.exists()
        fin()
      })
    })
})

lab.test('spec-load-basic', fin => {
  make_bar_instance(fin)
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        this.act('role:foo,load:bar', {id:out.id}, function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')

          var bob_instance = this.root.delegate(null,{custom:{
            'sys-owner': {
              usr: 'bob',
              org: 'wonderland'
            }
          }})

          // bob can't read alice owned entity, even in same org
          bob_instance.act('role:foo,load:bar', {id:out.id}, function(err, out) {
            expect(out).not.exists()
            fin()
          })
        })
      })
    })
})

lab.test('spec-load-org', fin => {
  make_bar_instance(fin,{read:{usr:false},write:{usr:false}})
    .ready(function() {
      this.act('role:foo,add:bar', {data:{w:1}}, function(err, out) {
        this.act('role:foo,load:bar', {id:out.id}, function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')

          var bob_instance = this.root.delegate(null,{custom:{
            'sys-owner': {
              usr: 'bob',
              org: 'wonderland'
            }
          }})

          // bob can read alice owned entity, in same org
          bob_instance.act('role:foo,load:bar', {id:out.id}, function(err, out) {
            expect(out.usr).equal('alice')
            expect(out.org).equal('wonderland')

            // can't change ownership
            this.act('role:foo,update:bar',{id:out.id,data:{w:2,usr:'qaz'}},
                     function(err, out) {
                       expect(out.usr).equal('alice')
                       expect(out.org).equal('wonderland')
                       fin()
                     })
          })
        })
      })
    })
})


lab.test('spec-load-admin', fin => {
  make_bar_instance(fin)
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        this.act('role:foo,load:bar', {id:out.id}, function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')

          var admin_instance = this.root.delegate(null,{custom:{
            'sys-owner': {
              usr: 'cathy',
              org: 'wonderland',
              case: 'admin'
            }
          }})

          // admin *can* read alice owned entity, in same org
          admin_instance.act('role:foo,load:bar', {y:1,id:out.id}, function(err, out) {
            expect(out).exists()
            expect(out.usr).equal('alice')
            expect(out.org).equal('wonderland')
            fin()
          })
        })
      })
    })
})



lab.test('spec-inject-no-usr', fin => {
  var spec = {inject:{usr:false}}
  make_bar_instance(fin,spec)
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).not.exists()
        expect(out.org).equal('wonderland')
        fin()
      })
    })
})

lab.test('spec-inject-no-usr-org', fin => {
  var spec = {inject:{usr:false,org:false}}
  make_bar_instance(fin,spec)
    .ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).not.exists()
        expect(out.org).not.exists()
        fin()
      })
    })
})


lab.test('intern', fin => {
  Seneca({legacy:{transport:false}})
    .test(fin)
    .use(Plugin,{annotate:[]})
    .ready(function() {
      expect(Plugin.intern.default_spec).exists()
      expect(Plugin.intern.deepextend).exists()

      var spec0 = Plugin.intern.make_spec({write:{org:false}})
      expect(spec0).contains({ write: { usr: true, org: false } })

      fin()
    })
})



/*
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
          user: { id: 'alice' },
          org: { id: 'wonderland' }
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
*/

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
        'sys-owner': {}
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

/*
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
      annotate: [{ base: 'core' }]
    })
    .delegate(null, {
      custom: {
        'sys-owner': {
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
*/
