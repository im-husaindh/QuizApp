const socket = io()
const el = (id) => document.getElementById(id)

let roomCode = null
let myNickname = null
let currentQuestionIndex = null
let answeredIndex = null
let countdownTimer = null

el('joinBtn').onclick = () => {
  roomCode = el('roomCodeInput').value.trim()
  myNickname = el('nickname').value.trim()
  socket.emit('joinRoom', { roomCode, nickname: myNickname }, (res) => {
    if (!res.ok) {
      el('joinError').textContent = res.error
      return
    }
    el('joinView').hidden = true
    el('waitingView').hidden = false
  })
}

socket.on('questionStart', ({ index, total, text, options, deadline }) => {
  currentQuestionIndex = index
  answeredIndex = null
  el('waitingView').hidden = true
  el('revealView').hidden = true
  el('questionView').hidden = false
  el('lockedMsg').hidden = true
  el('qIndex').textContent = index + 1
  el('qTotal').textContent = total
  el('qText').textContent = text
  el('options').innerHTML = ''
  options.forEach((opt, i) => {
    const btn = document.createElement('button')
    btn.textContent = opt
    btn.onclick = () => answer(i)
    el('options').appendChild(btn)
  })

  clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    const secondsLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000))
    el('timeLeft').textContent = secondsLeft
    if (secondsLeft <= 0) clearInterval(countdownTimer)
  }, 200)
})

function answer(optionIndex) {
  if (answeredIndex !== null) return
  answeredIndex = optionIndex
  el('lockedMsg').hidden = false
  socket.emit('submitAnswer', { roomCode, questionIndex: currentQuestionIndex, optionIndex }, () => {})
}

socket.on('reveal', ({ correctIndex, leaderboard }) => {
  clearInterval(countdownTimer)
  el('questionView').hidden = true
  el('revealView').hidden = false
  const correct = answeredIndex === correctIndex
  el('resultMsg').textContent = correct ? 'Correct!' : 'Wrong answer'
  const me = leaderboard.find(p => p.nickname === myNickname)
  el('myScore').textContent = me ? me.score : 0
})

socket.on('final', ({ leaderboard }) => {
  el('revealView').hidden = true
  el('finalView').hidden = false
  el('finalLeaderboard').innerHTML = leaderboard.map(p => `<li>${p.nickname}: ${p.score}</li>`).join('')
})
