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

el('backToQuizzesBtn').onclick = () => {
  el('quizEditor').hidden = true
  currentQuizId = null
  resetQuestionForm()
}

el('homeBtn').onclick = () => {
  if (!confirm('Go back to the dashboard? The session keeps running in the background, but you\'ll stop seeing live updates for it here.')) return
  el('live').hidden = true
  el('dashboard').hidden = false
  currentRoomCode = null
  loadQuizzes()
}

el('addQuestionBtn').onclick = () => {
  const text = el('qText').value.trim()
  const options = [el('qOpt0').value.trim(), el('qOpt1').value.trim(), el('qOpt2').value.trim(), el('qOpt3').value.trim()]
  if (!text || options.some(o => !o)) {
    alert('Question text and all 4 options are required.')
    return
  }
  const payload = {
    text,
    options,
    correctIndex: Number(el('qCorrect').value),
    timeLimitSeconds: Number(el('qTime').value)
  }
  const onDone = (res) => {
    if (res && res.ok === false) return alert(res.error)
    resetQuestionForm()
    refreshQuestions()
  }
  if (editingQuestionId) {
    socket.emit('updateQuestion', { questionId: editingQuestionId, ...payload }, onDone)
  } else {
    socket.emit('addQuestion', { quizId: currentQuizId, ...payload }, onDone)
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
const CLOCK_CIRCUMFERENCE = 2 * Math.PI * 54

socket.on('questionStart', ({ index, total, text, options, deadline, timeLimitSeconds }) => {
  el('lobbyView').hidden = true
  el('revealView').hidden = true
  el('questionView').hidden = false
  el('qIndex').textContent = index + 1
  el('qTotal').textContent = total
  el('liveQText').textContent = text
  el('qOptionsList').innerHTML = ''
  options.forEach(opt => {
    const li = document.createElement('li')
    li.textContent = opt
    el('qOptionsList').appendChild(li)
  })

  const clockProgress = el('clockProgress')
  clockProgress.style.strokeDasharray = String(CLOCK_CIRCUMFERENCE)

  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    const msLeft = Math.max(0, deadline - Date.now())
    const secondsLeft = Math.round(msLeft / 1000)
    el('timeLeft').textContent = secondsLeft
    const fraction = Math.max(0, Math.min(1, msLeft / (timeLimitSeconds * 1000)))
    clockProgress.style.strokeDashoffset = String(CLOCK_CIRCUMFERENCE * (1 - fraction))
    if (msLeft <= 0) clearInterval(countdownTimer)
  }, 200)
})

socket.on('reveal', ({ leaderboard, isLast }) => {
  clearInterval(countdownTimer)
  el('questionView').hidden = true
  el('revealView').hidden = false
  if (isLast) {
    el('revealHeading').textContent = 'All questions answered!'
    el('leaderboard').hidden = true
    el('leaderboard').innerHTML = ''
    el('nextBtn2').textContent = 'Show Results'
  } else {
    el('revealHeading').textContent = 'Leaderboard'
    el('leaderboard').hidden = false
    el('leaderboard').innerHTML = leaderboard.map(p => `<li>${escapeHtml(p.nickname)}: ${p.score}</li>`).join('')
    el('nextBtn2').textContent = 'Next question'
  }
})

socket.on('final', ({ leaderboard, winner }) => {
  el('revealView').hidden = true
  el('finalView').hidden = false
  el('winner').textContent = winner
  el('finalLeaderboard').innerHTML = leaderboard.map(p => `<li>${escapeHtml(p.nickname)}: ${p.score}</li>`).join('')
})
