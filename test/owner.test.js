/* Copyright (c) 2018-2019 voxgig and other contributors, MIT License */
'use strict'

const Util = require('util')

const Lab = require('lab')
const Code = require('code')
const lab = (exports.lab = Lab.script())
var describe = lab.describe
const expect = Code.expect
var it = make_it(lab)

const PluginValidator = require('seneca-plugin-validator')
const Seneca = require('seneca')
const Plugin = require('..')

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
          'list:bar',
          function(msg, reply) {
            this.make('core/bar').list$(msg.q, reply)
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


describe('owner', function() {
  it('validate', PluginValidator(Plugin, module))

  it('happy', fin => {
    make_bar_instance(fin)
      .ready(function() {
        this.act('role:foo,add:bar', function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')
          fin()
        })
      })
  })

  it('spec-load-basic', fin => {
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

  it('spec-load-field-match', fin => {
    var tmp = {}
    
    // w is only for reads, s for all modes, expect write
    make_bar_instance(fin,{fields:['s'],read:{w:true},write:{s:false}})
      .ready(function(){
        var writer = this      
        var reader = this.root.delegate(null,{custom:{
          'sys-owner': {
            usr: 'alice',
            org: 'wonderland',
            w:1,
            s:3
          }
        }})

        writer
          .gate()
          .act('role:foo,add:bar', {data:{w:1,s:3}}, function(err, bar1) {
            //console.log('BAR1', bar1, err&&err.message, err&&err.details)
            tmp.bar1 = bar1
          })
          .act('role:foo,add:bar', {data:{w:2,s:3}}, function(err, bar2) {
            //console.log('BAR2', bar2)
            tmp.bar2 = bar2
          })
          .act('role:foo,add:bar', {data:{w:1,s:4}}, function(err, bar3) {
            //console.log('BAR3', bar3)
            tmp.bar3 = bar3
          })
          .ready(function(){
            reader
              .gate()
            
            // w=1,s=3 => can read
              .act('role:foo,load:bar', {id:tmp.bar1.id}, function(err, out) {
                expect(out.w).equals(1)
              })
            
            // w=2,s=3 => can't read
              .act('role:foo,load:bar', {id:tmp.bar2.id}, function(err, out) {
                expect(out).not.exists()
              })    
            
            // w=1,s=4 => can't read
              .act('role:foo,load:bar', {id:tmp.bar3.id}, function(err, out) {
                expect(out).not.exists()
              })
            
              .ready(fin)
          })
      })
  })



  it('spec-load-org', fin => {
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


  it('spec-load-admin', fin => {
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
                case$: 'admin'
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

  it('spec-inject-no-usr', fin => {
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

  it('spec-inject-no-org', fin => {
    var spec = {inject:{org:false}}
    make_bar_instance(fin,spec)
      .ready(function() {      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).not.exists()
        fin()
      })
                        })
  })

  it('spec-inject-no-usr-org', fin => {
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

  it('spec-inject-undef', fin => {
    var spec = {inject:{zed:true}}
    make_bar_instance(fin,spec)
      .ready(function() {
        this.act('role:foo,add:bar', function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')
          expect(out.zed).not.exists()
          fin()
        })
      })
  })


  it('org-scenario', fin => {
    // grp0 fields assigns entity to group, but group is not checked by default
    var spec = {

      // require group match by default
      read:{
        grp0:true,

        // must be set manually for special admin only access
        admin_required:true
      },

      // require group match by default
      write:{
        grp0:true,

        // must be set manually for special admin only access
        admin_required:true
      },

      // add grp0 field automatically from owner
      inject:{
        grp0:true
      }
    }

    make_bar_instance(fin,spec)
      .act('sys:owner,hook:case,case:group',{
        modifier: function(spec, owner) {
          owner.grp0 = owner.group

          if('admin' === owner.group) {
            spec.read.admin_required = false
            spec.read.admin_required = false
          }
          
          // if admin or staff, then ignore usr and group
          if(['admin','staff'].includes(owner.group)) {
            spec.read.usr = false
            spec.write.usr = false
            spec.read.grp0 = false
            spec.write.grp0 = false
          }

          return spec
        }
      })
      .ready(function() {

        var cathy_admin_org0 = this.root.delegate(null,{
          custom: { 'sys-owner': {
            usr: 'cathy', org: 'org0', group: 'admin', case$: 'group',
            admin_required: true
          }}
        })
        
        var bob_admin_org1 = this.root.delegate(null,{
          custom: { 'sys-owner': {
            usr: 'bob', org: 'org1', group: 'admin', case$: 'group',
            admin_required: true
          }}
        })

        var alice_staff_org0 = this.root.delegate(null,{
          custom: { 'sys-owner': {
            usr: 'alice', org: 'org0', group: 'staff', case$: 'group'
          }}
        })

        var derek_staff_org1 = this.root.delegate(null,{
          custom: { 'sys-owner': {
            usr: 'derek', org: 'org1', group: 'staff', case$: 'group'
          }}
        })

        var evan_guest_org0 = this.root.delegate(null,{
          custom: { 'sys-owner': {
            usr: 'evan', org: 'org0', group: 'guest', case$: 'group'
          }}
        })

        var frank_helper_org0 = this.root.delegate(null,{
          custom: { 'sys-owner': {
            usr: 'frank', org: 'org0', group: 'helper', case$: 'group'
          }}
        })

        var imogen_helper_org0 = this.root.delegate(null,{
          custom: { 'sys-owner': {
            usr: 'imogen', org: 'org0', group: 'helper', case$: 'group'
          }}
        })

        
        var tmp = {}

        alice_staff_org0
          .act('role:foo,add:bar',{data:{d:0}}, function(err, d0) {tmp.d0 = d0})

        frank_helper_org0
          .act('role:foo,add:bar',{data:{d:1}}, function(err, d1) {tmp.d1 = d1})

        imogen_helper_org0
          .act('role:foo,add:bar',{data:{d:2}}, function(err, d2) {tmp.d2 = d2})

        derek_staff_org1
          .act('role:foo,add:bar',{data:{d:3}}, function(err, d3) {tmp.d3 = d3})
        
        cathy_admin_org0
          .act('role:foo,add:bar',{data:{d:4,admin_required:true}},
               function(err, d4) {tmp.d4 = d4})

        
        alice_staff_org0.ready(function() {
          bob_admin_org1.ready(function() {
            cathy_admin_org0.ready(function() {
              derek_staff_org1.ready(function() {
                evan_guest_org0.ready(function() {
                  frank_helper_org0.ready(function() {
                    imogen_helper_org0.ready(validate)
                  })
                })
              })
            })
          })
        })
        
        function validate() {
          // console.log(tmp)

          expect(tmp.d0).includes({d:0,usr:'alice',org:'org0',grp0:'staff'})
          expect(tmp.d1).includes({d:1,usr:'frank',org:'org0',grp0:'helper'})
          expect(tmp.d2).includes({d:2,usr:'imogen',org:'org0',grp0:'helper'})
          expect(tmp.d3).includes({d:3,usr:'derek',org:'org1',grp0:'staff'})
          expect(tmp.d4).includes({d:4,usr:'cathy',org:'org0',grp0:'admin',admin_required:true})

          validate_alice_staff_org0(
            validate_bob_admin_org1(
              validate_cathy_admin_org0(
                validate_derek_staff_org1(
                  validate_evan_guest_org0(
                    validate_frank_helper_org0(
                      validate_imogen_helper_org0(
                        fin)))))))
          
          function validate_cathy_admin_org0(done) {
            // admin of org0 can access all of org0, nothing in org1
            cathy_admin_org0
              .gate()
              .act('role:foo,list:bar',null, allowed('cathy-list','0124'))
              .act('role:foo,load:bar',{id:tmp.d0.id}, allowed('cathy-load-d0',{d:0}))
              .act('role:foo,load:bar',{id:tmp.d1.id}, allowed('cathy-load-d1',{d:1}))
              .act('role:foo,load:bar',{id:tmp.d2.id}, allowed('cathy-load-d2',{d:2}))
              .act('role:foo,load:bar',{id:tmp.d3.id}, denied('cathy-load-d3'))
              .act('role:foo,load:bar',{id:tmp.d4.id}, allowed('cathy-load-d4',{d:4}))
              .ready(done)
          }

          function validate_alice_staff_org0(done) {
            // staff of org0 can access all of org0, nothing in org1
            alice_staff_org0
              .gate()
              .act('role:foo,list:bar',null, allowed('alice-list','012'))
              .act('role:foo,load:bar',{id:tmp.d0.id}, allowed('alice-load-d0',{d:0}))
              .act('role:foo,load:bar',{id:tmp.d1.id}, allowed('alice-load-d1',{d:1}))
              .act('role:foo,load:bar',{id:tmp.d2.id}, allowed('alice-load-d2',{d:2}))
              .act('role:foo,load:bar',{id:tmp.d3.id}, denied('alice-load-d3'))
              .act('role:foo,load:bar',{id:tmp.d4.id}, denied('alice-load-d4'))
              .ready(done)
          }

          function validate_frank_helper_org0(done) {
            // helper of org0 can access only own data, nothing in org1
            frank_helper_org0
              .gate()
              .act('role:foo,list:bar',null, allowed('frank-list','1'))
              .act('role:foo,load:bar',{id:tmp.d0.id}, denied('frank-load-d0'))
              .act('role:foo,load:bar',{id:tmp.d1.id}, allowed('frank-load-d1',{d:1}))
              .act('role:foo,load:bar',{id:tmp.d2.id}, denied('frank-load-d2'))
              .act('role:foo,load:bar',{id:tmp.d3.id}, denied('frank-load-d3'))
              .ready(done)
          }

          function validate_bob_admin_org1(done) {
            // admin of org1 can access all of org1, nothing in org0
            bob_admin_org1
              .gate()
              .act('role:foo,list:bar',null, allowed('bob-list','3'))
              .act('role:foo,load:bar',{id:tmp.d0.id}, denied('bob-load-d0'))
              .act('role:foo,load:bar',{id:tmp.d1.id}, denied('bob-load-d1'))
              .act('role:foo,load:bar',{id:tmp.d2.id}, denied('bob-load-d2'))
              .act('role:foo,load:bar',{id:tmp.d3.id}, allowed('bob-load-d3',{d:3}))
              .ready(done)
          }

          function validate_imogen_helper_org0(done) {
            // helper of org0 can access only own data, nothing in org1
            imogen_helper_org0
              .gate()
              .act('role:foo,list:bar',null, allowed('imogen-list','2'))
              .act('role:foo,load:bar',{id:tmp.d0.id}, denied('imogen-load-d0'))
              .act('role:foo,load:bar',{id:tmp.d1.id}, denied('imogen-load-d1'))
              .act('role:foo,load:bar',{id:tmp.d2.id}, allowed('imogen-load-d2',{d:2}))
              .act('role:foo,load:bar',{id:tmp.d3.id}, denied('imogen-load-d3'))
              .ready(done)
          }

          function validate_evan_guest_org0(done) {
            // guests in org0 can access nothing
            evan_guest_org0
              .gate()
              .act('role:foo,list:bar',null, allowed('evan-list',''))
              .act('role:foo,load:bar',{id:tmp.d0.id}, denied('evan-load-d0'))
              .act('role:foo,load:bar',{id:tmp.d1.id}, denied('evan-load-d1'))
              .act('role:foo,load:bar',{id:tmp.d2.id}, denied('evan-load-d2'))
              .act('role:foo,load:bar',{id:tmp.d3.id}, denied('evan-load-d3'))
              .ready(done)
          }

          function validate_derek_staff_org1(done) {
            // staff of org1 can access all of org1, nothing in org0
            derek_staff_org1
              .gate()
              .act('role:foo,list:bar',null, allowed('derek-list','3'))
              .act('role:foo,load:bar',{id:tmp.d0.id}, denied('derek-load-d0'))
              .act('role:foo,load:bar',{id:tmp.d1.id}, denied('derek-load-d1'))
              .act('role:foo,load:bar',{id:tmp.d2.id}, denied('derek-load-d2'))
              .act('role:foo,load:bar',{id:tmp.d3.id}, allowed('derek-load-d3',{d:3}))
              .ready(done)
          }

          
          function allowed(mark,data) {
            return function(err, out) {
              // console.log('ALLOWED '+mark)
              expect(out).exists()
              if('string' === typeof(data)) {
                expect(out.map(x=>''+x.d).join('')).equal(data)
              }
              else {
                expect(out).includes(data)
              }
            }
          }

          function denied(mark,err_code) {
            return function(err, out) {
              // console.log('DENIED  '+mark)
              expect(out).not.exists()
              if(err_code) {
                expect(err.code).equal(err_code)
              }
            }
          }
        }
      })
  })

  it('intern', fin => {
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

})


function make_it(lab) {
  return function it(name, opts, func) {
    if ('function' === typeof opts) {
      func = opts
      opts = {}
    }
    
    lab.it(
      name,
      opts,
      Util.promisify(function(x, fin) {
        func(fin)
      })
    )
  }
}
