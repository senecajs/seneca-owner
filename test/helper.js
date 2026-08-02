/* Copyright (c) 2026 voxgig and other contributors, MIT License */
'use strict'

const { expect } = require('@hapi/code')

// Recursive partial-match assertion, equivalent to jest's `toMatchObject`:
// objects may have extra actual keys (ignored), arrays must match length
// and position, and matching recurses into nested objects/arrays.
function partial(actual, expected) {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).to.equal(true)
    expect(actual.length).to.equal(expected.length)
    expected.forEach((item, i) => partial(actual[i], item))
    return
  }

  if (expected !== null && typeof expected === 'object') {
    expect(actual !== null && typeof actual === 'object').to.equal(true)
    for (const key of Object.keys(expected)) {
      partial(actual[key], expected[key])
    }
    return
  }

  expect(actual).to.equal(expected)
}

// Equivalent to jest's `await expect(promise).rejects.toMatchObject(expected)`.
async function rejects(promise, expected) {
  let err

  try {
    await promise
  } catch (e) {
    err = e
  }

  expect(err).to.exist()
  partial(err, expected)
}

module.exports = { partial, rejects }
