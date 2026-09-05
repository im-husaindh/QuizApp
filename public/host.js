const socket = io()
let currentQuizId = null
let currentRoomCode = null
let editingQuestionId = null

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
      const span = document.createElement('span')
      span.textContent = quiz.title
      const editBtn = document.createElement('button')
      editBtn.textContent = 'Manage'
      editBtn.onclick = () => openQuizEditor(quiz.id, quiz.title)
      const deleteBtn = document.createElement('button')
      deleteBtn.textContent = 'Delete'
      deleteBtn.onclick = () => {
        if (!confirm(`Delete quiz "${quiz.title}"? This cannot be undone.`)) return
        socket.emit('deleteQuiz', { quizId: quiz.id }, () => {
          if (currentQuizId === quiz.id) {
            el('quizEditor').hidden = true
            currentQuizId = null
          }
          loadQuizzes()
        })
      }
      li.appendChild(span)
      li.appendChild(editBtn)
      li.appendChild(deleteBtn)
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
  resetQuestionForm()
  refreshQuestions()
}

function refreshQuestions() {
  socket.emit('getQuiz', { quizId: currentQuizId }, ({ questions }) => {
    el('questionList').innerHTML = ''
    questions.forEach(q => {
      const row = document.createElement('div')
      const span = document.createElement('span')
      span.textContent = q.text
      const editBtn = document.createElement('button')
      editBtn.textContent = 'Edit'
      editBtn.onclick = () => startEditQuestion(q)
      row.appendChild(span)
      row.appendChild(editBtn)
      el('questionList').appendChild(row)
    })
  })
}

function startEditQuestion(q) {
  editingQuestionId = q.id
  el('qText').value = q.text
  el('qOpt0').value = q.options[0]
  el('qOpt1').value = q.options[1]
  el('qOpt2').value = q.options[2]
  el('qOpt3').value = q.options[3]
  el('qCorrect').value = String(q.correctIndex)
  el('qTime').value = q.timeLimitSeconds
  el('addQuestionBtn').textContent = 'Update question'
  el('cancelEditBtn').hidden = false
}

function resetQuestionForm() {
  editingQuestionId = null
  el('qText').value = ''
  el('qOpt0').value = ''
  el('qOpt1').value = ''
  el('qOpt2').value = ''
  el('qOpt3').value = ''
  el('qCorrect').value = '0'
  el('qTime').value = 20
  el('addQuestionBtn').textContent = 'Add question'
  el('cancelEditBtn').hidden = true
}

el('cancelEditBtn').onclick = resetQuestionForm

el('addQuestionBtn').onclick = () => {
  const payload = {
    text: el('qText').value,
    options: [el('qOpt0').value, el('qOpt1').value, el('qOpt2').value, el('qOpt3').value],
    correctIndex: Number(el('qCorrect').value),
    timeLimitSeconds: Number(el('qTime').value)
  }
  if (editingQuestionId) {
    socket.emit('updateQuestion', { questionId: editingQuestionId, ...payload }, () => {
      resetQuestionForm()
      refreshQuestions()
    })
  } else {
    socket.emit('addQuestion', { quizId: currentQuizId, ...payload }, () => {
      resetQuestionForm()
      refreshQuestions()
    })
  }
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

let countdownTimer = null

socket.on('questionStart', ({ index, total, text, options, deadline }) => {
  el('lobbyView').hidden = true
  el('revealView').hidden = true
  el('questionView').hidden = false
  el('qIndex').textContent = index + 1
  el('qTotal').textContent = total
  el('qText').textContent = text
  el('qOptionsList').innerHTML = ''
  options.forEach(opt => {
    const li = document.createElement('li')
    li.textContent = opt
    el('qOptionsList').appendChild(li)
  })

  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000))
    el('timeLeft').textContent = secondsLeft
    if (secondsLeft <= 0) clearInterval(countdownTimer)
  }, 200)
})

socket.on('reveal', ({ leaderboard }) => {
  clearInterval(countdownTimer)
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
