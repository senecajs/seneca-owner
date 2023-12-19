/* Copyright (c) 2018-2023 voxgig and other contributors, MIT License */
'use strict'

const Util = require('util')

const Seneca = require('seneca')
const Plugin = require('..')

function makeSeneca() {
  return Seneca({ legacy: false })
    .test()
  // .quiet()
    .use('promisify')
    .use('entity')
    .use(Plugin, {
      ownerprop: 'principal.user',
      fields: ['id:owner_id'],
      annotate: [
        'sys:entity',
      ],
      ignore: [
        'sys:entity,name:qaz'
      ]
    })
    .ready()
}

describe('gateway', () => {

  test('principal', async () => {
    const s0 = await makeSeneca()

    // No ownerprop ('sysowner') so not activated
    let f0 = await s0.entity('foo').save$({x:1})
    //console.log(f0)
    expect(f0).toMatchObject({x:1})
    
    let f0r = await s0.entity('foo').load$(f0.id)
    // console.log(f0r)
    expect(f0r).toMatchObject({x:1,id:f0.id})
    
    const su0 = s0.delegate(null,{
      custom: { principal: { user: { id:'u0'} } }
    })
    // console.log(su0)

    let f0u0 = await su0.entity('foo').save$({x:2})
    // console.log(f0u0)
    expect(f0u0).toMatchObject({x:2,owner_id:'u0'})
    
    let f0u0r = await su0.entity('foo').load$(f0u0.id)
    // console.log(f0u0r)
    expect(f0u0r).toMatchObject({x:2,owner_id:'u0',id:f0u0.id})

    const su1 = s0.delegate(null,{
      custom: { principal: { user: { id:'u1'} } }
    })
    let f0u1r = await su1.entity('foo').load$(f0u0.id)
    // console.log(f0u1r) // null as not owned
    expect(f0u1r).toEqual(null)

    await su1.entity('foo').save$({x:3})
    await su1.entity('foo').save$({x:4})

    
    const listsu0 = await su0.entity('foo').list$()
    // console.log(listsu0)
    expect(listsu0).toMatchObject([{x:2,owner_id:'u0'}])

    const listsu1 = await su1.entity('foo').list$()
    // console.log(listsu1)
    expect(listsu1).toMatchObject([
      {x:3,owner_id:'u1'},
      {x:4,owner_id:'u1'}
    ])

    const lists0 = await s0.entity('foo').list$()
    // console.log(lists0)
    expect(lists0).toMatchObject([
      {x:1},
      {x:2,owner_id:'u0'},
      {x:3,owner_id:'u1'},
      {x:4,owner_id:'u1'}
    ])

    // Not yours to delete!
    await su1.entity('foo').remove$(f0u0.id)
    let f0u0d = await su0.entity('foo').load$(f0u0.id)
    expect(f0u0d).toMatchObject({x:2,owner_id:'u0',id:f0u0.id})

    // Now it's gone
    await su0.entity('foo').remove$(f0u0.id)
    let f0u0dd = await su0.entity('foo').load$(f0u0.id)
    expect(f0u0dd).toEqual(null)

    const listsu0d = await su0.entity('foo').list$()
    // console.log(listsu0)
    expect(listsu0d).toMatchObject([])

    const listsu1d = await su1.entity('foo').list$()
    // console.log(listsu1)
    expect(listsu1d).toMatchObject([
      {x:3,owner_id:'u1'},
      {x:4,owner_id:'u1'}
    ])

    const lists0d = await s0.entity('foo').list$()
    // console.log(lists0)
    expect(lists0d).toMatchObject([
      {x:1},
      {x:3,owner_id:'u1'},
      {x:4,owner_id:'u1'}
    ])
  })


  test('ignore', async () => {
    const s0 = await makeSeneca()
    
    const su0 = s0.delegate(null,{
      custom: { principal: { user: { id:'u0'} } }
    })
    // console.log(su0)

    let q0u0 = await su0.entity('qaz').save$({y:1})
    // console.log(q0u0)
    expect(q0u0).toMatchObject({y:1})
    expect(q0u0.owner_id).toBeUndefined()
    
  })
})
