// test/scoring.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { computeScore } = require('../server/scoring')

test('wrong answer scores 0', () => {
  assert.equal(computeScore({ correct: false, remainingMs: 5000, limitMs: 10000 }), 0)
})

test('correct answer with 0ms remaining scores 500 (floor)', () => {
  assert.equal(computeScore({ correct: true, remainingMs: 0, limitMs: 10000 }), 500)
})

test('instant correct answer scores 1000 (ceiling)', () => {
  assert.equal(computeScore({ correct: true, remainingMs: 10000, limitMs: 10000 }), 1000)
})

test('correct answer halfway through scores 750', () => {
  assert.equal(computeScore({ correct: true, remainingMs: 5000, limitMs: 10000 }), 750)
})

test('a late/negative remaining time still floors at 500 for a correct answer', () => {
  assert.equal(computeScore({ correct: true, remainingMs: -100, limitMs: 10000 }), 500)
})
