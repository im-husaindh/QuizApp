const socket = io()
let currentQuizId = null
let currentRoomCode = null

const el = (id) => document.getElementById(id)

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

el('loginBtn').onclick = () => {
  socket.emit('hostLogin', el('password').value, (res) => {
    if (res.ok) {
      el('login').hidden = true
      el('dashboard').hidden = false
      loadQuizzes()
    } else {
      el('loginError').textContent = res.error
    }
  })
}

function loadQuizzes() {
  socket.emit('listQuizzes', ({ quizzes }) => {
    el('quizList').innerHTML = ''
    for (const quiz of quizzes) {
      const li = document.createElement('li')
      li.textContent = quiz.title + ' '
      const editBtn = document.createElement('button')
      editBtn.textContent = 'Manage'
      editBtn.onclick = () => openQuizEditor(quiz.id, quiz.title)
      li.appendChild(editBtn)
      el('quizList').appendChild(li)
    }
  })
}

el('createQuizBtn').onclick = () => {
  const title = el('newQuizTitle').value.trim()
  if (!title) return
  socket.emit('createQuiz', { title }, ({ quiz }) => {
    el('newQuizTitle').value = ''
    loadQuizzes()
    openQuizEditor(quiz.id, quiz.title)
  })
}

function openQuizEditor(quizId, title) {
  currentQuizId = quizId
  el('quizEditor').hidden = false
  el('quizEditorTitle').textContent = title
  refreshQuestions()
}

function refreshQuestions() {
  socket.emit('getQuiz', { quizId: currentQuizId }, ({ questions }) => {
    el('questionList').innerHTML = questions.map(q => `<p>${escapeHtml(q.text)}</p>`).join('')
  })
}

el('addQuestionBtn').onclick = () => {
  const options = [el('qOpt0').value, el('qOpt1').value, el('qOpt2').value, el('qOpt3').value]
  socket.emit('addQuestion', {
    quizId: currentQuizId,
    text: el('qText').value,
    options,
    correctIndex: Number(el('qCorrect').value),
    timeLimitSeconds: Number(el('qTime').value)
  }, () => {
    el('qText').value = ''
    el('qOpt0').value = ''
    el('qOpt1').value = ''
    el('qOpt2').value = ''
    el('qOpt3').value = ''
    refreshQuestions()
  })
}

el('startSessionBtn').onclick = () => {
  socket.emit('startSession', { quizId: currentQuizId }, ({ ok, roomCode, error }) => {
    if (!ok) return alert(error)
    currentRoomCode = roomCode
    el('dashboard').hidden = true
    el('live').hidden = false
    el('roomCode').textContent = roomCode
  })
}

function goToNext() {
  socket.emit('hostNext', { roomCode: currentRoomCode }, () => {})
}
el('nextBtn').onclick = goToNext
el('nextBtn2').onclick = goToNext

socket.on('lobbyUpdate', ({ count, participants }) => {
  el('playerCount').textContent = count
  el('playerList').innerHTML = participants.map(n => `<li>${escapeHtml(n)}</li>`).join('')
})

socket.on('questionStart', ({ index, total }) => {
  el('lobbyView').hidden = true
  el('revealView').hidden = true
  el('questionView').hidden = false
  el('qIndex').textContent = index + 1
  el('qTotal').textContent = total
})

socket.on('reveal', ({ leaderboard }) => {
  el('questionView').hidden = true
  el('revealView').hidden = false
  el('leaderboard').innerHTML = leaderboard.map(p => `<li>${escapeHtml(p.nickname)}: ${p.score}</li>`).join('')
})

socket.on('final', ({ leaderboard, winner }) => {
  el('revealView').hidden = true
  el('finalView').hidden = false
  el('winner').textContent = winner
  el('finalLeaderboard').innerHTML = leaderboard.map(p => `<li>${escapeHtml(p.nickname)}: ${p.score}</li>`).join('')
})
