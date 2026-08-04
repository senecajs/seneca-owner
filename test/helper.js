/* Copyright (c) 2026 voxgig and other contributors, MIT License */
'use strict'

const { partialDeepStrictEqual } = require('node:assert')
const { expect } = require('@hapi/code')

function partial(actual, expected) {
  if (Array.isArray(expected)) {
    expect(actual.length).to.equal(expected.length)
  }
  partialDeepStrictEqual(actual, expected)
}

async function rejects(promise, expected) {
  const err = await expect(promise).to.reject()
  for (const key of Object.keys(expected)) {
    expect(err[key]).to.equal(expected[key])
  }
}

module.exports = { partial, rejects }
