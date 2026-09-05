const { computeScore } = require('./scoring')

const rooms = new Map()

function generateRoomCode() {
  let code
  do {
    code = String(Math.floor(100000 + Math.random() * 900000))
  } while (rooms.has(code))
  return code
}

function createRoom(quizId, questions) {
  const roomCode = generateRoomCode()
  rooms.set(roomCode, {
    roomCode,
    quizId,
    questions,
    currentIndex: -1,
    phase: 'lobby',
    players: new Map(),
    answers: new Map(),
    deadline: null,
    timer: null,
    onReveal: null
  })
  return roomCode
}

function getRoomState(roomCode) {
  return rooms.get(roomCode)
}

function joinRoom(roomCode, playerId, nickname) {
  const room = rooms.get(roomCode)
  if (!room) return { ok: false, error: 'Room not found' }
  // ponytail: no mid-quiz join/rejoin support — a disconnected player cannot
  // rejoin once the lobby has closed. Add Socket.IO session resumption +
  // a persisted playerId (e.g. localStorage) if late-rejoin becomes a requirement.
  if (room.phase !== 'lobby') return { ok: false, error: 'Quiz already in progress' }
  for (const p of room.players.values()) {
    if (p.nickname.toLowerCase() === nickname.toLowerCase()) {
      return { ok: false, error: 'Nickname already taken' }
    }
  }
  room.players.set(playerId, { nickname, totalScore: 0 })
  return { ok: true }
}

function lobbySnapshot(roomCode) {
  const room = rooms.get(roomCode)
  const participants = [...room.players.values()].map(p => p.nickname)
  return { count: participants.length, participants }
}

function startQuestion(roomCode, onReveal) {
  const room = rooms.get(roomCode)
  room.currentIndex += 1
  if (room.currentIndex >= room.questions.length) {
    room.phase = 'final'
    return null
  }
  const q = room.questions[room.currentIndex]
  room.phase = 'question'
  room.answers = new Map()
  room.deadline = Date.now() + q.timeLimitSeconds * 1000
  room.onReveal = onReveal
  clearTimeout(room.timer)
  room.timer = setTimeout(() => triggerReveal(roomCode), q.timeLimitSeconds * 1000)
  return {
    index: room.currentIndex,
    total: room.questions.length,
    text: q.text,
    options: q.options,
    timeLimitSeconds: q.timeLimitSeconds,
    deadline: room.deadline
  }
}

function submitAnswer(roomCode, playerId, questionIndex, optionIndex) {
  const room = rooms.get(roomCode)
  if (!room) return { ok: false, error: 'Room not found' }
  if (room.phase !== 'question' || questionIndex !== room.currentIndex) {
    return { ok: false, error: 'No active question' }
  }
  if (!room.players.has(playerId)) return { ok: false, error: 'Not joined' }
  if (room.answers.has(playerId)) return { ok: false, error: 'Already answered' }
  room.answers.set(playerId, { optionIndex, answeredAt: Date.now() })
  if (room.answers.size === room.players.size) {
    triggerReveal(roomCode)
  }
  return { ok: true }
}

function triggerReveal(roomCode) {
  const room = rooms.get(roomCode)
  if (!room || room.phase !== 'question') return
  clearTimeout(room.timer)
  room.phase = 'reveal'
  const q = room.questions[room.currentIndex]
  for (const [playerId, player] of room.players) {
    const answer = room.answers.get(playerId)
    const correct = !!answer && answer.optionIndex === q.correctIndex
    const remainingMs = answer ? room.deadline - answer.answeredAt : 0
    const points = computeScore({ correct, remainingMs, limitMs: q.timeLimitSeconds * 1000 })
    player.totalScore += points
  }
  const leaderboard = buildLeaderboard(room)
  const payload = { index: room.currentIndex, correctIndex: q.correctIndex, leaderboard }
  if (room.onReveal) room.onReveal(payload)
}

function buildLeaderboard(room) {
  return [...room.players.values()]
    .map(p => ({ nickname: p.nickname, score: p.totalScore }))
    .sort((a, b) => b.score - a.score)
}

function getFinal(roomCode) {
  const room = rooms.get(roomCode)
  const leaderboard = buildLeaderboard(room)
  return { leaderboard, winner: leaderboard[0] ? leaderboard[0].nickname : null }
}

module.exports = { createRoom, getRoomState, joinRoom, lobbySnapshot, startQuestion, submitAnswer, getFinal }
