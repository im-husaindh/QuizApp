const db = require('./db')
const rooms = require('./rooms')

const HOST_PASSWORD = process.env.HOST_PASSWORD || 'quiz'
const authenticatedHosts = new Set()

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('hostLogin', (password, cb) => {
      if (password === HOST_PASSWORD) {
        authenticatedHosts.add(socket.id)
        cb({ ok: true })
      } else {
        cb({ ok: false, error: 'Wrong password' })
      }
    })

    socket.on('listQuizzes', (cb) => {
      cb({ quizzes: db.listQuizzes() })
    })

    socket.on('createQuiz', ({ title }, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      cb({ quiz: db.createQuiz(title) })
    })

    socket.on('addQuestion', ({ quizId, text, options, correctIndex, timeLimitSeconds }, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      cb({ question: db.addQuestion(quizId, { text, options, correctIndex, timeLimitSeconds }) })
    })

    socket.on('getQuiz', ({ quizId }, cb) => {
      cb(db.getQuizWithQuestions(quizId) || { quiz: null, questions: [] })
    })

    socket.on('startSession', ({ quizId }, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      const data = db.getQuizWithQuestions(quizId)
      if (!data || data.questions.length === 0) return cb({ ok: false, error: 'Quiz has no questions' })
      const roomCode = rooms.createRoom(quizId, data.questions)
      socket.join(roomCode)
      cb({ ok: true, roomCode })
    })

    socket.on('hostNext', ({ roomCode }, cb) => {
      if (!authenticatedHosts.has(socket.id)) return cb({ ok: false, error: 'Not authenticated' })
      const q = rooms.startQuestion(roomCode, (payload) => io.to(roomCode).emit('reveal', payload))
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

    socket.on('joinRoom', ({ roomCode, nickname }, cb) => {
      const result = rooms.joinRoom(roomCode, socket.id, nickname)
      if (!result.ok) return cb(result)
      socket.join(roomCode)
      io.to(roomCode).emit('lobbyUpdate', rooms.lobbySnapshot(roomCode))
      cb({ ok: true })
    })

    socket.on('submitAnswer', ({ roomCode, questionIndex, optionIndex }, cb) => {
      cb(rooms.submitAnswer(roomCode, socket.id, questionIndex, optionIndex))
    })
  })
}

module.exports = { registerSocketHandlers }
