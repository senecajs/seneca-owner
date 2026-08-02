/* Copyright (c) 2026 voxgig and other contributors, MIT License */
'use strict'

const { expect } = require('@hapi/code')

// Recursing into a Date, RegExp, Map etc. would compare zero own keys and
// pass vacuously, so they are compared whole, as jest's `toMatchObject` did.
function is_plain_object(val) {
  if (null === val || 'object' !== typeof val) return false
  const proto = Object.getPrototypeOf(val)
  return null === proto || Object.prototype === proto
}

// Recursive partial-match assertion, equivalent to jest's `toMatchObject`:
// objects may have extra actual keys (ignored), arrays must match length
// and position, and matching recurses into nested objects/arrays.
//
// Neither `assert.partialDeepStrictEqual` nor @hapi/code's `.to.contain()`
// can replace this: both treat an expected array as a *subset* of the actual
// array, so list assertions would silently stop checking length and position.
function partial(actual, expected) {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).to.equal(true)
    expect(actual.length).to.equal(expected.length)
    expected.forEach((item, i) => partial(actual[i], item))
    return
  }

  if (is_plain_object(expected)) {
    expect(actual !== null && 'object' === typeof actual).to.equal(true)
    for (const key of Object.keys(expected)) {
      partial(actual[key], expected[key])
    }
    return
  }

  expect(actual).to.equal(expected)
}

// Equivalent to jest's `await expect(promise).rejects.toMatchObject(expected)`.
async function rejects(promise, expected) {
  const err = await expect(promise).to.reject()
  partial(err, expected)
}

module.exports = { partial, rejects }
