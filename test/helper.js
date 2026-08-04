/* Copyright (c) 2026 voxgig and other contributors, MIT License */
'use strict'

const { partialDeepStrictEqual } = require('node:assert')
const { expect } = require('@hapi/code')

// Seneca test mode logs every action error with a full stack trace. Many of
// these tests deliberately trigger denials, so the expected errors drown out
// the results. Pass LOG to `.test()` to keep test mode (error propagation,
// callpoints) with the log silenced. Set SENECA_TEST_LOG=test (or any Seneca
// log level) to see the errors again when debugging.
const LOG = process.env.SENECA_TEST_LOG || 'silent'

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

module.exports = { LOG, partial, rejects }
