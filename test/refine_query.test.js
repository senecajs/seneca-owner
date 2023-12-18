/* Copyright (c) 2020 voxgig and other contributors, MIT License */
'use strict'

const Util = require('util')


const Seneca = require('seneca')

const intern = require('../dist/Owner.js').intern
const refine_query = require('../dist/refine_query').refine_query

const s0 = Seneca({ legacy: false }).test().use('promisify')
const qp0 = 'q'

describe('refine_query', function () {
  test('read-query-single', async () => {
    let m0 = {}
    let p0 = { fields: ['w'], read: { w: true }, public: { read: {} } }
    let o0 = { w: 1 }

    // injects q if needed
    refine_query(s0, m0, qp0, p0, o0, intern, {})
    // console.log(m0)
    expect(m0).toEqual({ q: { w: 1 } })

    // extends existing q
    let m1 = { q: { z: 2 } }
    refine_query(s0, m1, qp0, p0, o0, intern, {})
    // console.log(m0)
    expect(m1).toEqual({ q: { w: 1, z: 2 } })

    // ignore field
    let m2 = {}
    let o1 = { w: null }
    refine_query(s0, m2, qp0, p0, o1, intern, {})
    //console.log(m2)
    expect(m2).toEqual({ q: {} })

    // public - field p_w true => don't use 'w' check
    let m3 = { q: { p_w: true } }
    let p1 = s0.util.deep(p0)
    p1.public.read.w = 'p_w'
    refine_query(s0, m3, qp0, p1, o0, intern, {})
    //console.log(m3)
    expect(m3).toEqual({ q: { p_w: true } })

    // public - field is_public true => don't use any checks
    let m4 = { q: { is_public: true } }
    let p2 = s0.util.deep(p0)
    p2.public.read['*'] = 'is_public'
    refine_query(s0, m4, qp0, p2, o0, intern, {})
    //console.log(m4)
    expect(m4).toEqual({ q: { is_public: true } })

    // public - field is_public not present => use checks
    let m5 = {}
    refine_query(s0, m5, qp0, p2, o0, intern, {})
    //console.log(m5)
    expect(m5).toEqual({ q: { w: 1 } })
  })

  test('read-query-multiple', async () => {
    let m0 = {}
    let p0 = { fields: ['w'], read: { w: true }, public: { read: {} } }
    let o0 = { w: [1, 2] }

    // injects q if needed
    refine_query(s0, m0, qp0, p0, o0, intern, {})
    expect(m0).toEqual({ q: { w: [1, 2] } })

    // extends existing q
    let m1 = { q: { z: 2 } }
    refine_query(s0, m1, qp0, p0, o0, intern, {})
    expect(m1).toEqual({ q: { w: [1, 2], z: 2 } })

    // allows valid existing q - single
    let m2 = { q: { w: 1 } }
    refine_query(s0, m2, qp0, p0, o0, intern, {})
    expect(m2).toEqual({ q: { w: 1 } })

    // rejects invalid existing q - single
    let m3 = { q: { w: 3 } }
    try {
      refine_query(s0, m3, qp0, p0, o0, intern, {})
      Code.fail()
    } catch (e) {
      expect(e.code).toEqual('field-not-valid')
      expect(e.details).toMatchObject({
        bad_query_val: 3,
        field: 'w',
        query_val: 3,
        valid_owner_vals: [1, 2],
      })
    }

    // allows valid existing q - multiple
    let m4 = { q: { w: [2] } }
    refine_query(s0, m4, qp0, p0, o0, intern, {})
    expect(m4).toEqual({ q: { w: [2] } })

    // allows valid existing q - multiple
    let m5 = { q: { w: [1, 2] } }
    refine_query(s0, m5, qp0, p0, o0, intern, {})
    expect(m5).toEqual({ q: { w: [1, 2] } })

    // rejects invalid existing q - multiple
    let m6 = { q: { w: [1, 3] } }
    try {
      refine_query(s0, m6, qp0, p0, o0, intern, {})
      Code.fail()
    } catch (e) {
      expect(e.code).toEqual('field-values-not-valid')
      expect(e.details).toMatchObject({
        field: 'w',
        bad_query_val: 3,
        query_val: [1, 3],
        valid_owner_vals: [1, 2],
      })
    }

    // ignore field
    let m7 = {}
    let o1 = { w: null }
    refine_query(s0, m7, qp0, p0, o1, intern, {})
    //console.log(m2)
    expect(m7).toEqual({ q: {} })
  })
})
