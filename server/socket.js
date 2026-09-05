const db = require('./db')
const rooms = require('./rooms')

const HOST_PASSWORD = process.env.HOST_PASSWORD || 'quiz'
if (!process.env.HOST_PASSWORD) console.warn('WARNING: HOST_PASSWORD not set, using default password "quiz" — set HOST_PASSWORD before a real event.')
const authenticatedHosts = new Set()

function on(socket, event, handler) {
  socket.on(event, (a, b) => {
    // Socket.IO omits the data argument entirely for an ack-only emit
    // (e.g. socket.emit('listQuizzes', cb)), so the callback can land in
    // either position — detect it instead of assuming a fixed (arg, cb) shape.
    const ack = typeof b === 'function' ? b : (typeof a === 'function' ? a : () => {})
    const arg = typeof a === 'function' ? {} : (a || {})
    try {
      handler(arg, ack)
    } catch (err) {
      console.error(`Error handling '${event}':`, err)
      ack({ ok: false, error: 'Server error' })
    }
  })
}

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    on(socket, 'hostLogin', (payload, cb) => {
      const password = payload
      if (password === HOST_PASSWORD) {
        authenticatedHosts.add(socket.id)
        cb({ ok: true })
      } else {
        cb({ ok: false, error: 'Wrong password' })
      }
    })

    on(socket, 'listQuizzes', (payload, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      cb({ quizzes: db.listQuizzes() })
    })

    on(socket, 'createQuiz', (payload, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      const { title } = payload
      cb({ quiz: db.createQuiz(title) })
    })

    on(socket, 'addQuestion', (payload, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      const { quizId, text, options, correctIndex, timeLimitSeconds } = payload
      cb({ question: db.addQuestion(quizId, { text, options, correctIndex, timeLimitSeconds }) })
    })

    on(socket, 'getQuiz', (payload, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      const { quizId } = payload
      cb(db.getQuizWithQuestions(quizId) || { quiz: null, questions: [] })
    })

    on(socket, 'startSession', (payload, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      const { quizId } = payload
      const data = db.getQuizWithQuestions(quizId)
      if (!data || data.questions.length === 0) return cb({ ok: false, error: 'Quiz has no questions' })
      const roomCode = rooms.createRoom(quizId, data.questions)
      socket.join(roomCode)
      cb({ ok: true, roomCode })
    })

    on(socket, 'hostNext', (payload, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      const { roomCode } = payload
      const q = rooms.startQuestion(roomCode, (revealPayload) => {
        const { personal, ...broadcastPayload } = revealPayload
        io.to(roomCode).emit('reveal', broadcastPayload)
        personal.forEach(p => io.to(p.playerId).emit('yourResult', { score: p.score, rank: p.rank }))
      })
      if (q === undefined) {
        return cb({ ok: false, error: 'Not ready for next question' })
      }
      if (q) {
        io.to(roomCode).emit('questionStart', q)
      } else {
        const room = rooms.getRoomState(roomCode)
        const finalResult = rooms.getFinal(roomCode)
        db.saveResults(room.quizId, roomCode, finalResult.leaderboard)
        io.to(roomCode).emit('final', finalResult)
      }
      cb({ ok: true })
    })

    on(socket, 'joinRoom', (payload, cb) => {
      const { roomCode, nickname } = payload
      const result = rooms.joinRoom(roomCode, socket.id, nickname)
      if (!result.ok) return cb(result)
      socket.join(roomCode)
      io.to(roomCode).emit('lobbyUpdate', rooms.lobbySnapshot(roomCode))
      cb({ ok: true })
    })

    on(socket, 'submitAnswer', (payload, cb) => {
      const { roomCode, questionIndex, optionIndex } = payload
      cb(rooms.submitAnswer(roomCode, socket.id, questionIndex, optionIndex))
    })
  })
}

module.exports = { registerSocketHandlers }
