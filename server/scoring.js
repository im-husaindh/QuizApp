function computeScore({ correct, remainingMs, limitMs }) {
  if (!correct) return 0
  const ratio = Math.max(0, Math.min(1, remainingMs / limitMs))
  return Math.round(500 + 500 * ratio)
}

module.exports = { computeScore }
