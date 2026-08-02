/* Copyright (c) 2026 voxgig and other contributors, MIT License */
'use strict'

const { expect } = require('@hapi/code')

function is_plain_object(val) {
  if (null === val || 'object' !== typeof val) return false
  const proto = Object.getPrototypeOf(val)
  return null === proto || Object.prototype === proto
}

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

async function rejects(promise, expected) {
  const err = await expect(promise).to.reject()
  partial(err, expected)
}

module.exports = { partial, rejects }
