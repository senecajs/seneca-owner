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

function make_bar_instance(fin, spec, explain) {
  spec = spec || {}
  return (
    Seneca({ legacy: { transport: false } })
      // turn off quiet to see errors
      .test('quiet', fin)
      .use('entity')
      .use(Plugin, {
        explain: explain,
        fields: ['usr', 'org'],
        annotate: [
          'role:entity,cmd:save,base:core',
          'role:entity,cmd:load,base:core',
          'role:entity,cmd:list,base:core',
          'role:entity,cmd:remove,base:core'
        ]
      })
      .ready(function() {
        var make_spec = this.export('owner/make_spec')
        var full_spec = make_spec(spec)

        this.act('sys:owner,hook:case,case:admin', {
          modifiers: {
            query: function(spec, owner) {
              if ('cathy' === owner.usr) {
                spec.read.usr = false
                spec.write.usr = false
              }
              return spec
            }
          }
        })

        // NOTE: ee:1 => error expected

        this.add(
          'role:foo,add:bar',
          { custom$: { 'sys-owner-spec': full_spec } },
          function(msg, reply) {
            this.make(
              'core/bar',
              Object.assign({ x: Math.random() }, msg.data)
            ).save$(reply)
          }
        )

        this.fix('role:foo', null, { 'sys-owner-spec': full_spec })
          .add('load:bar', function(msg, reply) {
            var q = { ...{}, ...msg.q }
            if (msg.id) {
              q.id = msg.id
            }
            this.delegate({ ee: msg.ee })
              .make('core/bar')
              .load$(q, reply)
          })
          .add('list:bar', function(msg, reply) {
            this.delegate({ ee: msg.ee })
              .make('core/bar')
              .list$(msg.q, reply)
          })
          .add('remove:bar', function(msg, reply) {
            this.delegate({ ee: msg.ee })
              .make('core/bar')
              .remove$(msg.q, reply)
          })
          .add('update:bar', function(msg, reply) {
            var q = { ...{}, ...msg.q }
            if (msg.id) {
              q.id = msg.id
            }
            this.delegate({ ee: msg.ee })
              .make('core/bar')
              .load$(q, function(err, out) {
                if (err) return reply(err)
                if (null == out) return reply()

                out.data$(msg.data).save$(function(err, out) {
                  reply(err, out)
                })
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
  )
}

describe('owner', function() {
  it('validate', PluginValidator(Plugin, module))

  it('happy', fin => {
    make_bar_instance(fin).ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).equal('wonderland')
        fin()
      })
    })
  })

  it('spec-load-basic', fin => {
    make_bar_instance(fin).ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        this.act('role:foo,load:bar', { id: out.id }, function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')

          var bob_instance = this.root.delegate(null, {
            custom: {
              'sys-owner': {
                usr: 'bob',
                org: 'wonderland'
              }
            }
          })

          // bob can't read alice owned entity, even in same org
          bob_instance.act('role:foo,load:bar', { id: out.id }, function(
            err,
            out
          ) {
            expect(out).not.exists()
            fin()
          })
        })
      })
    })
  })

  it('spec-load-field-match', fin => {
    var tmp = {}

    // w can have multiple values
    make_bar_instance(null, { fields: ['w'] }).ready(function() {
      var w_instance = this.root.delegate(null, {
        custom: {
          'sys-owner': {
            usr: 'alice',
            org: 'wonderland',
            w: [null, 1, 2]
          }
        }
      })

      w_instance
        .gate()
        // no w also works
        .act('role:foo,add:bar', { data: { d: 1 } }, function(err, bar1) {
          if (err) return fin(err)
          tmp.bar1 = bar1
        })
        .act('role:foo,add:bar', { data: { d: 2, w: 1 } }, function(err, bar2) {
          if (err) return fin(err)
          tmp.bar2 = bar2
        })
        .act('role:foo,add:bar', { data: { d: 3, w: 2 } }, function(err, bar3) {
          if (err) return fin(err)
          tmp.bar3 = bar3
        })

        // SHOULD FAIL
        .act('role:foo,add:bar', { data: { d: 4, w: 3 } }, function(err, bar4) {
          expect(err).exist()
          expect(err.code).equal('create-not-allowed')
        })
        .ready(function() {
          this.gate()

            .act('role:foo,load:bar', { id: tmp.bar1.id }, function(err, out) {
              if (err) return fin(err)
              expect(out).exists()
              expect(out.w).equals(null)
            })

            .act('role:foo,load:bar', { id: tmp.bar2.id }, function(err, out) {
              if (err) return fin(err)
              expect(out).exists()
              expect(out.w).equals(1)
            })

            .act('role:foo,load:bar', { id: tmp.bar3.id }, function(err, out) {
              if (err) return fin(err)
              expect(out).exists()
              expect(out.w).equals(2)
            })

            .ready(fin)
        })
    })
  })

  it('spec-load-field-match', fin => {
    var tmp = {}

    // w is only for reads, s for all modes, expect write
    make_bar_instance(fin, {
      fields: ['s'],
      read: { w: true },
      write: { s: false }
    }).ready(function() {
      var writer = this
      var reader = this.root.delegate(null, {
        custom: {
          'sys-owner': {
            usr: 'alice',
            org: 'wonderland',
            w: 1,
            s: 3
          }
        }
      })

      writer
        .gate()
        .act('role:foo,add:bar', { data: { w: 1, s: 3 } }, function(err, bar1) {
          tmp.bar1 = bar1
        })
        .act('role:foo,add:bar', { data: { w: 2, s: 3 } }, function(err, bar2) {
          tmp.bar2 = bar2
        })
        .act('role:foo,add:bar', { data: { w: 1, s: 4 } }, function(err, bar3) {
          tmp.bar3 = bar3
        })
        .ready(function() {
          reader
            .gate()

            // w=1,s=3 => can read
            .act('role:foo,load:bar', { id: tmp.bar1.id }, function(err, out) {
              expect(out.w).equals(1)
            })

            // w=2,s=3 => can't read
            .act('role:foo,load:bar', { id: tmp.bar2.id }, function(err, out) {
              expect(out).not.exists()
            })

            // w=1,s=4 => can't read
            .act('role:foo,load:bar', { id: tmp.bar3.id }, function(err, out) {
              expect(out).not.exists()
            })

            .ready(fin)
        })
    })
  })

  it('spec-load-org', fin => {
    make_bar_instance(fin, {
      read: { usr: false },
      write: { usr: false }
    }).ready(function() {
      this.act('role:foo,add:bar', { data: { w: 1 } }, function(err, out) {
        this.act('role:foo,load:bar', { id: out.id }, function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')

          var bob_instance = this.root.delegate(null, {
            custom: {
              'sys-owner': {
                usr: 'bob',
                org: 'wonderland'
              }
            }
          })

          // bob can read alice owned entity, in same org
          bob_instance.act('role:foo,load:bar', { id: out.id }, function(
            err,
            out
          ) {
            expect(out.usr).equal('alice')
            expect(out.org).equal('wonderland')

            fin()
          })
        })
      })
    })
  })

  it('spec-load-admin', fin => {
    make_bar_instance(fin).ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        this.act('role:foo,load:bar', { id: out.id }, function(err, out) {
          expect(out.usr).equal('alice')
          expect(out.org).equal('wonderland')

          var admin_instance = this.root.delegate(null, {
            custom: {
              'sys-owner': {
                usr: 'cathy',
                org: 'wonderland',
                case$: 'admin'
              }
            }
          })

          // admin *can* read alice owned entity, in same org
          admin_instance.act(
            'role:foo,load:bar',
            { y: 1, id: out.id },
            function(err, out) {
              expect(out).exists()
              expect(out.usr).equal('alice')
              expect(out.org).equal('wonderland')
              fin()
            }
          )
        })
      })
    })
  })

  it('spec-inject-no-usr', fin => {
    var spec = { inject: { usr: false } }
    make_bar_instance(fin, spec).ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).not.exists()
        expect(out.org).equal('wonderland')
        fin()
      })
    })
  })

  it('spec-inject-no-org', fin => {
    var spec = { inject: { org: false } }
    make_bar_instance(fin, spec).ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).equal('alice')
        expect(out.org).not.exists()
        fin()
      })
    })
  })

  it('spec-inject-no-usr-org', fin => {
    var spec = { inject: { usr: false, org: false } }
    make_bar_instance(fin, spec).ready(function() {
      this.act('role:foo,add:bar', function(err, out) {
        expect(out.usr).not.exists()
        expect(out.org).not.exists()
        fin()
      })
    })
  })

  it('spec-inject-undef', fin => {
    var spec = { inject: { zed: true } }
    make_bar_instance(fin, spec).ready(function() {
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
      read: {
        grp0: true,

        // must be set manually for special admin only access
        admin_required: true
      },

      // require group match by default
      write: {
        grp0: true,

        // must be set manually for special admin only access
        admin_required: true
      },

      // add grp0 field automatically from owner
      inject: {
        grp0: true
      }
    }

    make_bar_instance(fin, spec, true)
      .act('sys:owner,hook:case,case:group', {
        modifiers: {
          query: function(spec, owner) {
            owner.grp0 = owner.group

            // if admin or staff, then ignore usr and group
            if (['admin', 'staff'].includes(owner.group)) {
              spec.read.usr = false
              spec.write.usr = false
              spec.read.grp0 = false
              spec.write.grp0 = false
            }

            return spec
          }
        }
      })
      .ready(function() {
        var cathy_admin_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'cathy',
              org: 'org0',
              group: 'admin',
              case$: 'group'
            }
          }
        })

        var bob_admin_org1 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'bob',
              org: 'org1',
              group: 'admin',
              case$: 'group'
            }
          }
        })

        var alice_staff_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'alice',
              org: 'org0',
              group: 'staff',
              case$: 'group'
            }
          }
        })

        var derek_staff_org1 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'derek',
              org: 'org1',
              group: 'staff',
              case$: 'group'
            }
          }
        })

        var evan_guest_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'evan',
              org: 'org0',
              group: 'guest',
              case$: 'group'
            }
          }
        })

        var frank_helper_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'frank',
              org: 'org0',
              group: 'helper',
              case$: 'group'
            }
          }
        })

        var imogen_helper_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'imogen',
              org: 'org0',
              group: 'helper',
              case$: 'group'
            }
          }
        })

        var tmp = {}

        alice_staff_org0.act('role:foo,add:bar', { data: { d: 0 } }, function(
          err,
          d0
        ) {
          tmp.d0 = d0
        })

        frank_helper_org0.act('role:foo,add:bar', { data: { d: 1 } }, function(
          err,
          d1
        ) {
          tmp.d1 = d1
        })

        imogen_helper_org0.act('role:foo,add:bar', { data: { d: 2 } }, function(
          err,
          d2
        ) {
          tmp.d2 = d2
        })

        derek_staff_org1.act('role:foo,add:bar', { data: { d: 3 } }, function(
          err,
          d3
        ) {
          tmp.d3 = d3
        })

        cathy_admin_org0.act('role:foo,add:bar', { data: { d: 4 } }, function(
          err,
          d4
        ) {
          tmp.d4 = d4
        })

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
          expect(tmp.d0).includes({
            d: 0,
            usr: 'alice',
            org: 'org0',
            grp0: 'staff'
          })
          expect(tmp.d1).includes({
            d: 1,
            usr: 'frank',
            org: 'org0',
            grp0: 'helper'
          })
          expect(tmp.d2).includes({
            d: 2,
            usr: 'imogen',
            org: 'org0',
            grp0: 'helper'
          })
          expect(tmp.d3).includes({
            d: 3,
            usr: 'derek',
            org: 'org1',
            grp0: 'staff'
          })
          expect(tmp.d4).includes({
            d: 4,
            usr: 'cathy',
            org: 'org0',
            grp0: 'admin'
          })

          validate_alice_staff_org0(
            validate_bob_admin_org1(
              validate_cathy_admin_org0(
                validate_derek_staff_org1(
                  validate_evan_guest_org0(
                    validate_frank_helper_org0(validate_imogen_helper_org0(fin))
                  )
                )
              )
            )
          )

          function validate_cathy_admin_org0(done) {
            // admin of org0 can access all of org0, nothing in org1
            cathy_admin_org0
              .gate()
              .act('role:foo,list:bar', null, allowed('cathy-list', '0124'))
              .act(
                'role:foo,load:bar',
                { id: tmp.d0.id },
                allowed('cathy-load-d0', { d: 0 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d1.id },
                allowed('cathy-load-d1', { d: 1 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d2.id },
                allowed('cathy-load-d2', { d: 2 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d3.id },
                denied('cathy-load-d3')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d4.id },
                allowed('cathy-load-d4', { d: 4 })
              )
              .ready(done)
          }

          function validate_alice_staff_org0(done) {
            // staff of org0 can access all of org0, nothing in org1
            alice_staff_org0
              .gate()
              .act('role:foo,list:bar', null, allowed('alice-list', '0124'))
              .act(
                'role:foo,load:bar',
                { id: tmp.d0.id },
                allowed('alice-load-d0', { d: 0 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d1.id },
                allowed('alice-load-d1', { d: 1 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d2.id },
                allowed('alice-load-d2', { d: 2 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d3.id },
                denied('alice-load-d3')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d4.id },
                allowed('alice-load-d4', { d: 4 })
              )
              .ready(done)
          }

          function validate_frank_helper_org0(done) {
            // helper of org0 can access only own data, nothing in org1
            frank_helper_org0
              .gate()
              .act('role:foo,list:bar', null, allowed('frank-list', '1'))
              .act(
                'role:foo,load:bar',
                { id: tmp.d0.id },
                denied('frank-load-d0')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d1.id },
                allowed('frank-load-d1', { d: 1 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d2.id },
                denied('frank-load-d2')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d3.id },
                denied('frank-load-d3')
              )
              .ready(done)
          }

          function validate_bob_admin_org1(done) {
            // admin of org1 can access all of org1, nothing in org0
            bob_admin_org1
              .gate()
              .act('role:foo,list:bar', null, allowed('bob-list', '3'))
              .act(
                'role:foo,load:bar',
                { id: tmp.d0.id },
                denied('bob-load-d0')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d1.id },
                denied('bob-load-d1')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d2.id },
                denied('bob-load-d2')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d3.id },
                allowed('bob-load-d3', { d: 3 })
              )
              .ready(done)
          }

          function validate_imogen_helper_org0(done) {
            // helper of org0 can access only own data, nothing in org1
            imogen_helper_org0
              .gate()
              .act('role:foo,list:bar', null, allowed('imogen-list', '2'))
              .act(
                'role:foo,load:bar',
                { id: tmp.d0.id },
                denied('imogen-load-d0')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d1.id },
                denied('imogen-load-d1')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d2.id },
                allowed('imogen-load-d2', { d: 2 })
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d3.id },
                denied('imogen-load-d3')
              )
              .ready(done)
          }

          function validate_evan_guest_org0(done) {
            // guests in org0 can access nothing
            evan_guest_org0
              .gate()
              .act('role:foo,list:bar', null, allowed('evan-list', ''))
              .act(
                'role:foo,load:bar',
                { id: tmp.d0.id },
                denied('evan-load-d0')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d1.id },
                denied('evan-load-d1')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d2.id },
                denied('evan-load-d2')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d3.id },
                denied('evan-load-d3')
              )
              .ready(done)
          }

          function validate_derek_staff_org1(done) {
            // staff of org1 can access all of org1, nothing in org0
            derek_staff_org1
              .gate()
              .act('role:foo,list:bar', null, allowed('derek-list', '3'))
              .act(
                'role:foo,load:bar',
                { id: tmp.d0.id },
                denied('derek-load-d0')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d1.id },
                denied('derek-load-d1')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d2.id },
                denied('derek-load-d2')
              )
              .act(
                'role:foo,load:bar',
                { id: tmp.d3.id },
                allowed('derek-load-d3', { d: 3 })
              )
              .ready(done)
          }
        }
      })
  })

  it('group-scenario', fin => {
    var spec = {
      fields: ['group']
    }

    function error_handler(err) {
      return

      if (
        !(
          err.details &&
          err.details.caller &&
          err.details.caller.includes('ee: 1')
        )
      ) {
        console.log('UNEXPECTED ERROR', err.message, err.details, err.stack)
        return fin(err)
      }
    }

    make_bar_instance(error_handler, spec, true)
      .act('sys:owner,hook:case,case:group', {
        modifiers: {
          query: function(spec, owner, msg) {
            // admin group queries ignore usr and group
            if (owner.group.includes('admin')) {
              spec.read.usr = false
              spec.write.usr = false
              spec.read.group = false
              spec.write.group = false
            }

            // staff group queries ignore usr and group
            else if (owner.group.includes('staff')) {
              spec.read.usr = false
              spec.write.usr = false
              spec.read.group = false
              spec.write.group = false
            }

            // ignore usr if query group is one of user's groups
            else if (msg.q && null != msg.q.group) {
              if (owner.group.includes(msg.q.group)) {
                spec.read.usr = false
                spec.write.usr = false
              }
            }

            return spec
          },

          list: function(spec, owner, msg, list) {
            // if not admin, remove anything in admin group
            if (!owner.group.includes('admin')) {
              list = list.filter(x => 'admin' != x.group)
            }
            return list
          },

          entity: function(spec, owner, msg, ent) {
            if (ent && ent.group) {
              // if user in group of entity, then can access even if not owner
              if (owner.group.includes(ent.group)) {
                spec.read.usr = false
                spec.write.usr = false
              }

              // must be admin to access admin group entities
              if ('admin' === ent.group && !owner.group.includes('admin')) {
                spec.read.group = true
                spec.write.group = true
              }
            }

            return spec
          }
        }
      })

      .ready(function() {
        var cathy_admin_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'cathy',
              org: 'org0',
              group: ['admin', 'staff'],
              case$: 'group'
            }
          }
        })

        var bob_root_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'bob',
              org: 'org0',
              group: []
            },
            'sys-owner-spec': {
              active: false
            }
          }
        })

        var alice_staff_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'alice',
              org: 'org0',
              group: ['staff'],
              case$: 'group'
            }
          }
        })

        var evan_guest_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'evan',
              org: 'org0',
              group: ['guest'],
              case$: 'group'
            }
          }
        })

        var frank_helper_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'frank',
              org: 'org0',
              group: [null, 'helper'],
              case$: 'group'
            }
          }
        })

        var imogen_helper_org0 = this.root.delegate(null, {
          custom: {
            'sys-owner': {
              usr: 'imogen',
              org: 'org0',
              group: [null, 'helper'],
              case$: 'group'
            }
          }
        })

        var tmp = {}

        alice_staff_org0.act(
          'role:foo,add:bar',
          { data: { id$: 'd0', d: 0 } },
          function(err, d0) {
            tmp.d0 = d0
          }
        )

        frank_helper_org0.act(
          'role:foo,add:bar',
          { data: { id$: 'd1', d: 1, group: 'helper' } },
          function(err, d1) {
            tmp.d1 = d1
          }
        )

        imogen_helper_org0.act(
          'role:foo,add:bar',
          { data: { id$: 'd2', d: 2, group: 'helper' } },
          function(err, d2) {
            tmp.d2 = d2
          }
        )

        cathy_admin_org0.act(
          'role:foo,add:bar',
          { data: { id$: 'd4', d: 4 } },
          function(err, d4) {
            tmp.d4 = d4
          }
        )

        frank_helper_org0.act(
          'role:foo,add:bar',
          { data: { id$: 'd5', d: 5 } },
          function(err, d5) {
            tmp.d5 = d5
          }
        )

        imogen_helper_org0.act(
          'role:foo,add:bar',
          { data: { id$: 'd7', d: 7 } },
          function(err, d7) {
            tmp.d7 = d7
          }
        )

        alice_staff_org0.ready(function() {
          cathy_admin_org0.ready(function() {
            evan_guest_org0.ready(function() {
              frank_helper_org0.ready(function() {
                imogen_helper_org0.ready(validate)
              })
            })
          })
        })

        function validate() {
          expect(tmp.d0).includes({
            d: 0,
            group: 'staff',
            org: 'org0',
            usr: 'alice'
          })

          expect(tmp.d1).includes({
            d: 1,
            group: 'helper',
            org: 'org0',
            usr: 'frank'
          })
          expect(tmp.d5).includes({
            d: 5,
            group: null,
            org: 'org0',
            usr: 'frank'
          })

          expect(tmp.d2).includes({
            d: 2,
            group: 'helper',
            org: 'org0',
            usr: 'imogen'
          })
          expect(tmp.d7).includes({
            d: 7,
            group: null,
            org: 'org0',
            usr: 'imogen'
          })

          expect(tmp.d4).includes({
            d: 4,
            group: 'admin',
            org: 'org0',
            usr: 'cathy'
          })

          // TODO: evan, imogen
          validate_cathy_admin_org0(
            validate_bob_root_org0(
              validate_alice_staff_org0(
                validate_frank_helper_org0(validate_imogen_helper_org0(fin))
              )
            )
          )()

          function validate_cathy_admin_org0(done) {
            return function() {
              // admin of org0 can access all of org0
              cathy_admin_org0
                .gate()
                .act('role:foo,list:bar', null, allowed('cathy-list', '012457'))
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d0.id },
                  allowed('cathy-load-d0', { d: 0 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d1.id },
                  allowed('cathy-load-d1', { d: 1 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d2.id },
                  allowed('cathy-load-d2', { d: 2 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d4.id },
                  allowed('cathy-load-d4', { d: 4 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d5.id },
                  allowed('cathy-load-d5', { d: 5 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d7.id },
                  allowed('cathy-load-d7', { d: 7 })
                )
                .act(
                  'role:foo,update:bar',
                  { id: tmp.d1.id, data: { v: 1 } },
                  allowed('cathy-update-d1', { d: 1, v: 1 })
                )

                .act('role:mem-store,cmd:dump', function(err, out) {
                  //console.log('DATA cathy')
                  //console.dir(out,{depth:3})
                })

                .ready(function() {
                  var d999 = this.make('core/bar').data$({ d: 999 })
                  d999.id = 'd999'
                  d999.save$(function(err) {
                    expect(err.code).equal('save-not-found')
                    done()
                  })
                })
            }
          }

          function validate_bob_root_org0(done) {
            return function() {
              // owner not active
              bob_root_org0
                .gate()
                .act('role:foo,list:bar', null, allowed('bob-list', '012457'))
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d0.id },
                  allowed('bob-load-d0', { d: 0 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d1.id },
                  allowed('bob-load-d1', { d: 1 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d2.id },
                  allowed('bob-load-d2', { d: 2 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d4.id },
                  allowed('bob-load-d4', { d: 4 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d5.id },
                  allowed('bob-load-d5', { d: 5 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d7.id },
                  allowed('bob-load-d7', { d: 7 })
                )
                .act(
                  'role:foo,update:bar',
                  { id: tmp.d7.id, data: { v: 1 } },
                  allowed('bob-update-d7', { d: 7, v: 1 })
                )
                .ready(done)
            }
          }

          function validate_alice_staff_org0(done) {
            return function() {
              // alice does not have access to d4 as admin group
              alice_staff_org0
                .gate()
                .act('role:foo,list:bar', null, allowed('alice-list', '01257'))
                .act(
                  'role:foo,list:bar',
                  { q: { group: 'admin' } },
                  allowed('alice-list-admin', '')
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d0.id },
                  allowed('alice-load-d0', { d: 0 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d1.id },
                  allowed('alice-load-d1', { d: 1, v: 1 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d2.id },
                  allowed('alice-load-d2', { d: 2 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d4.id },
                  denied('alice-load-d4')
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d5.id },
                  allowed('alice-load-d5', { d: 5 })
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d7.id },
                  allowed('alice-load-d7', { d: 7 })
                )

                .act(
                  'role:foo,update:bar',
                  { id: tmp.d1.id, data: { v: 2 } },
                  allowed('alice-update-d1', { d: 1, v: 2 })
                )

                // staff can't change ownership
                .act(
                  'role:foo,update:bar',
                  { ee: 1, q: { id: 'd1' }, data: { usr: 'imogen' } },
                  denied('alice-update-d1-usr', 'update-not-allowed')
                )

                .act('role:mem-store,cmd:dump', function(err, out) {
                  //console.log('DATA alice')
                  //console.dir(out,{depth:3})
                })

                .ready(done)
            }
          }

          function validate_frank_helper_org0(done) {
            return function() {
              // helper of org0 can access own data and helper data
              frank_helper_org0
                .gate()
                .act('role:foo,list:bar', null, allowed('frank-list-all', '15'))

                // specify group to see everything in group
                .act(
                  'role:foo,list:bar',
                  { q: { group: 'helper' } },
                  allowed('frank-list-helper', '12')
                )

                .act(
                  'role:foo,list:bar',
                  { ee: 1, q: { group: 'staff' } },
                  denied('frank-list-staff', 'field-not-valid')
                )

                .act(
                  'role:foo,load:bar',
                  { id: tmp.d0.id },
                  denied('frank-load-d0')
                )

                .act(
                  'role:foo,load:bar',
                  { id: tmp.d1.id },
                  allowed('frank-load-d1', { d: 1, v: 2 })
                )

                // can access other people's stuff, in same group
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d2.id },
                  allowed('frank-load-d2', { d: 2 })
                )

                // can't access other people's stuff, if not in same group
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d7.id },
                  denied('frank-load-d7')
                )

                .act(
                  'role:foo,load:bar',
                  { id: tmp.d4.id },
                  denied('frank-load-d4')
                )
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d5.id },
                  allowed('frank-load-d5', { d: 5 })
                )

                // NOTE: tests queries that don't use id, with group
                .act(
                  'role:foo,load:bar',
                  { q: { d: 1, group: 'helper' } },
                  allowed('frank-load-helper-no-id-d1', { d: 1 })
                )
                .act(
                  'role:foo,load:bar',
                  { q: { d: 2, group: 'helper' } },
                  allowed('frank-load-helper-no-id-d2', { d: 2 })
                )
                .act(
                  'role:foo,load:bar',
                  { ee: 1, q: { d: 2, group: 'bad-group' } },
                  denied('frank-load-bad-group-no-id-d2', 'field-not-valid')
                )

                // denied as even though owned, not in group
                .act(
                  'role:foo,load:bar',
                  { q: { d: 5, group: 'helper' } },
                  denied('frank-load-helper-no-id-d5')
                )
                .act(
                  'role:foo,load:bar',
                  { q: { id: tmp.d5.id, group: 'helper' } },
                  denied('frank-load-helper-d5')
                )

                .act(
                  'role:foo,load:bar',
                  { q: { id: tmp.d1.id, group: 'helper' } },
                  allowed('frank-load-helper-d1', { d: 1 })
                )
                .act(
                  'role:foo,load:bar',
                  { q: { id: tmp.d2.id, group: 'helper' } },
                  allowed('frank-load-helper-d2', { d: 2 })
                )
                .act(
                  'role:foo,load:bar',
                  { q: { id: tmp.d2.id, group: 'bad-group' } },
                  denied('frank-load-bad-group-d2')
                )

                // not yours, and not in group you can access
                .act(
                  'role:foo,load:bar',
                  { id: tmp.d7.id },
                  denied('frank-load-d7')
                )

                .act(
                  'role:foo,update:bar',
                  { id: tmp.d1.id, data: { v: 3 } },
                  allowed('frank-update-d1', { d: 1, v: 3 })
                )

                // can update in group, even if not owner
                .act(
                  'role:foo,update:bar',
                  { id: tmp.d2.id, data: { v: 1 } },
                  allowed('frank-update-d2', { d: 2, v: 1 })
                )

                //.ready(done); return; frank_helper_org0

                .act(
                  'role:foo,update:bar',
                  { id: tmp.d7.id, data: { v: 1 } },
                  denied('frank-update-d7')
                )

                .act('role:mem-store,cmd:dump', function(err, out) {
                  Object.keys(out.core.bar).forEach(id => {
                    delete out.core.bar[id].x
                  })

                  expect(out).includes({
                    core: {
                      bar: {
                        d0: {
                          entity$: '-/core/bar',
                          d: 0,
                          group: 'staff',
                          org: 'org0',
                          usr: 'alice',
                          id: 'd0'
                        },
                        d1: {
                          entity$: '-/core/bar',
                          d: 1,
                          group: 'helper',
                          org: 'org0',
                          usr: 'frank',
                          id: 'd1',
                          v: 3
                        },
                        d2: {
                          entity$: '-/core/bar',
                          d: 2,
                          group: 'helper',
                          org: 'org0',
                          usr: 'imogen',
                          id: 'd2',
                          v: 1
                        },
                        d4: {
                          entity$: '-/core/bar',
                          d: 4,
                          group: 'admin',
                          org: 'org0',
                          usr: 'cathy',
                          id: 'd4'
                        },
                        d5: {
                          entity$: '-/core/bar',
                          d: 5,
                          group: null,
                          org: 'org0',
                          usr: 'frank',
                          id: 'd5'
                        },
                        d7: {
                          entity$: '-/core/bar',
                          d: 7,
                          group: null,
                          org: 'org0',
                          usr: 'imogen',
                          id: 'd7',
                          v: 1
                        }
                      }
                    }
                  })
                })

                .ready(done)
            }
          }

          function validate_imogen_helper_org0(done) {
            return function() {
              // helper of org0 can access own data and helper data
              imogen_helper_org0
                .gate()
                .act('role:foo,list:bar', allowed('imogen-list-all', '27'))

                // specify group to see everything in group
                .act(
                  'role:foo,list:bar',
                  { q: { group: 'helper' } },
                  allowed('imogen-list-helper', '12')
                )

                .act(
                  'role:foo,remove:bar',
                  { q: { id: 'd7' } },
                  allowed('imogen-remove-d7', null)
                )
                .act('role:foo,list:bar', allowed('imogen-list-all', '2'))

                .act(
                  'role:foo,remove:bar',
                  { q: { id: 'd2' } },
                  allowed('imogen-remove-d2', null)
                )
                .act('role:foo,list:bar', allowed('imogen-list-all', ''))

                .act(
                  'role:foo,remove:bar',
                  { q: { id: 'd1', group: 'helper' } },
                  allowed('imogen-remove-d1', null)
                )
                .act(
                  'role:foo,list:bar',
                  { q: { group: 'helper' } },
                  allowed('imogen-list-all', '')
                )

                .act(
                  'role:foo,remove:bar',
                  { q: { id: 'd0' } },
                  denied('imogen-remove-d0')
                )
                .act(
                  'role:foo,remove:bar',
                  { q: { id: 'd4' } },
                  denied('imogen-remove-d4')
                )
                .act(
                  'role:foo,remove:bar',
                  { q: { id: 'd5' } },
                  denied('imogen-remove-d5')
                )

                .act('role:mem-store,cmd:dump', function(err, out) {
                  expect(out).includes({
                    core: {
                      bar: {
                        d0: {
                          entity$: '-/core/bar',
                          d: 0,
                          group: 'staff',
                          org: 'org0',
                          usr: 'alice',
                          id: 'd0'
                        },
                        d4: {
                          entity$: '-/core/bar',
                          d: 4,
                          group: 'admin',
                          org: 'org0',
                          usr: 'cathy',
                          id: 'd4'
                        },
                        d5: {
                          entity$: '-/core/bar',
                          d: 5,
                          group: null,
                          org: 'org0',
                          usr: 'frank',
                          id: 'd5'
                        }
                      }
                    }
                  })
                })
                .ready(done)
            }
          }
        }
      })
  })

  it('intern', fin => {
    Seneca({ legacy: { transport: false } })
      .test(fin)
      .use(Plugin)
      .ready(function() {
        expect(Plugin.intern.default_spec).exists()
        expect(Plugin.intern.deepextend).exists()

        var spec0 = Plugin.intern.make_spec({ write: { org: false } })
        expect(spec0).contains({ write: { usr: true, org: false } })

        expect(Plugin.intern.match('a', 'a')).true()
        expect(Plugin.intern.match('a', 'b')).false()
        expect(Plugin.intern.match(null, 'a')).false()
        expect(Plugin.intern.match([], 'a')).false()
        expect(Plugin.intern.match(['a'], 'a')).true()
        expect(Plugin.intern.match(['a'], null)).false()
        expect(Plugin.intern.match(['a', 'x'], 'a')).true()
        expect(Plugin.intern.match(['x', 'a'], 'a')).true()
        expect(Plugin.intern.match(['x', 'a'], 'b')).false()
        expect(Plugin.intern.match(['x', 'a'], null)).false()

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

function allowed(mark, data) {
  return function(err, out) {
    //console.log('ALLOWED '+mark)
    expect(err).not.exists()

    if (null !== data) {
      expect(out).exists()

      if ('string' === typeof data) {
        expect(out.map(x => '' + x.d).join('')).equal(data)
      } else {
        expect(out).includes(data)
      }
    }
  }
}

function denied(mark, err_code) {
  return function(err, out) {
    //console.log('DENIED  '+mark)
    expect(out).not.exists()
    if (err_code) {
      expect(err.code).equal(err_code)
    }
  }
}
