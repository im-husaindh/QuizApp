# Live Quiz App (Kahoot-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live, timed multiple-choice quiz web app (Kahoot-style) supporting ~500 concurrent participants, with speed-based scoring, a per-question leaderboard, and a final winner reveal.

**Architecture:** Single Node.js process (Express + Socket.IO) serves plain HTML/CSS/JS pages and holds one active quiz session per room in server memory; SQLite persists quiz definitions and finished-session results only.

**Tech Stack:** Node.js, Express, Socket.IO, better-sqlite3, vanilla HTML/CSS/JS (no build step), Node's built-in `node:test` runner.

**Spec:** `docs/superpowers/specs/2026-09-05-kahoot-quiz-app-design.md`

## Global Constraints

- Single Node.js server process; no horizontal scaling, no Redis/pub-sub.
- Live session state (lobby membership, current question, in-progress answers) lives only in an in-memory `Map`, keyed by room code — never written to SQLite.
- SQLite (`better-sqlite3`, no ORM) persists only `quizzes`, `questions`, and finished-session `results`.
- Host access is gated by one shared password (env var `HOST_PASSWORD`), not per-user accounts.
- Scoring: wrong/no answer = 0; correct = `round(500 + 500 * (remaining_ms / limit_ms))`, computed server-side from the server-received answer timestamp.
- No mid-quiz join: a nickname can only join a room while it is in the `lobby` phase.
- No per-question answer audit log — only final per-participant totals are persisted.
- Only one automated test module is in scope: the scoring formula. No test framework beyond `node:test`, no e2e suite.

---

## File Structure

```
code/
  package.json
  .gitignore
  server/
    index.js     - Express app + HTTP server + Socket.IO bootstrap
    db.js        - SQLite schema + quiz/question/result CRUD
    scoring.js   - pure score-calculation function
    rooms.js     - in-memory room state machine (lobby/question/reveal/final)
    socket.js    - Socket.IO event handlers wiring rooms.js + db.js
  public/
    style.css    - shared minimal styling
    host.html / host.js   - host dashboard + live control view
    play.html / play.js   - participant join + play view
  test/
    scoring.test.js
  data/          - sqlite db file (gitignored)
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `server/index.js`

**Interfaces:**
- Produces: an HTTP server on `process.env.PORT || 3000` serving static files from `public/`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "kahoot-quiz-app",
  "version": "1.0.0",
  "private": true,
  "main": "server/index.js",
  "scripts": {
    "start": "node server/index.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
data/*.db
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

- [ ] **Step 4: Create a placeholder `server/index.js`**

```js
const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')

const app = express()
app.use(express.static(path.join(__dirname, '..', 'public')))

const server = http.createServer(app)
const io = new Server(server)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Quiz server listening on port ${PORT}`))

module.exports = server
```

- [ ] **Step 5: Create an empty `public/` placeholder and verify boot**

Run: `mkdir -p public data && echo "ok" > public/index.html && node server/index.js`
Expected: console prints `Quiz server listening on port 3000`. Visit `http://localhost:3000/index.html` (or `curl`) and see `ok`. Stop the server (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore server/index.js public/index.html
git commit -m "Scaffold Express + Socket.IO server"
```

---

### Task 2: Scoring module (TDD)

**Files:**
- Create: `server/scoring.js`
- Test: `test/scoring.test.js`

**Interfaces:**
- Produces: `computeScore({ correct: boolean, remainingMs: number, limitMs: number }) -> number`, used by `rooms.js` (Task 4).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scoring.test.js`
Expected: FAIL — `Cannot find module '../server/scoring'`.

- [ ] **Step 3: Write minimal implementation**

```js
// server/scoring.js
function computeScore({ correct, remainingMs, limitMs }) {
  if (!correct) return 0
  const ratio = Math.max(0, Math.min(1, remainingMs / limitMs))
  return Math.round(500 + 500 * ratio)
}

module.exports = { computeScore }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scoring.test.js`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/scoring.js test/scoring.test.js
git commit -m "Add Kahoot-style speed scoring with tests"
```

---

### Task 3: SQLite persistence layer

**Files:**
- Create: `server/db.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createQuiz(title) -> { id, title }`
  - `addQuestion(quizId, { text, options: [4 strings], correctIndex, timeLimitSeconds }) -> { id, quizId, text, options, correctIndex, timeLimitSeconds }`
  - `listQuizzes() -> [{ id, title }]`
  - `getQuizWithQuestions(quizId) -> { quiz: {id, title}, questions: [{id, text, options, correctIndex, timeLimitSeconds}] } | null`
  - `saveResults(quizId, sessionCode, leaderboard: [{ nickname, score }]) -> void`

  Used by `socket.js` (Task 5).

- [ ] **Step 1: Write `server/db.js`**

```js
const path = require('path')
const Database = require('better-sqlite3')

const db = new Database(path.join(__dirname, '..', 'data', 'quiz.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id),
    text TEXT NOT NULL,
    option1 TEXT NOT NULL,
    option2 TEXT NOT NULL,
    option3 TEXT NOT NULL,
    option4 TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    time_limit_seconds INTEGER NOT NULL,
    sort_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL REFERENCES quizzes(id),
    session_code TEXT NOT NULL,
    nickname TEXT NOT NULL,
    total_score INTEGER NOT NULL,
    played_at INTEGER NOT NULL
  );
`)

function createQuiz(title) {
  const info = db.prepare('INSERT INTO quizzes (title, created_at) VALUES (?, ?)').run(title, Date.now())
  return { id: info.lastInsertRowid, title }
}

function addQuestion(quizId, { text, options, correctIndex, timeLimitSeconds }) {
  const sortOrder = db.prepare('SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ?').get(quizId).n
  const info = db.prepare(`
    INSERT INTO questions (quiz_id, text, option1, option2, option3, option4, correct_index, time_limit_seconds, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(quizId, text, options[0], options[1], options[2], options[3], correctIndex, timeLimitSeconds, sortOrder)
  return { id: info.lastInsertRowid, quizId, text, options, correctIndex, timeLimitSeconds }
}

function listQuizzes() {
  return db.prepare('SELECT id, title FROM quizzes ORDER BY created_at DESC').all()
}

function getQuizWithQuestions(quizId) {
  const quiz = db.prepare('SELECT id, title FROM quizzes WHERE id = ?').get(quizId)
  if (!quiz) return null
  const rows = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order').all(quizId)
  const questions = rows.map(r => ({
    id: r.id,
    text: r.text,
    options: [r.option1, r.option2, r.option3, r.option4],
    correctIndex: r.correct_index,
    timeLimitSeconds: r.time_limit_seconds
  }))
  return { quiz, questions }
}

function saveResults(quizId, sessionCode, leaderboard) {
  const insert = db.prepare('INSERT INTO results (quiz_id, session_code, nickname, total_score, played_at) VALUES (?, ?, ?, ?, ?)')
  const now = Date.now()
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(quizId, sessionCode, row.nickname, row.score, now)
  })
  insertMany(leaderboard)
}

module.exports = { createQuiz, addQuestion, listQuizzes, getQuizWithQuestions, saveResults }
```

- [ ] **Step 2: Manually verify the schema and CRUD**

Run:
```bash
rm -f data/quiz.db
node -e "
const db = require('./server/db');
const quiz = db.createQuiz('Test Quiz');
db.addQuestion(quiz.id, { text: '2+2?', options: ['3','4','5','6'], correctIndex: 1, timeLimitSeconds: 10 });
console.log(JSON.stringify(db.getQuizWithQuestions(quiz.id)));
db.saveResults(quiz.id, '123456', [{ nickname: 'Alice', score: 900 }]);
console.log(db.listQuizzes());
"
```
Expected: prints the quiz with one question (options `['3','4','5','6']`, `correctIndex: 1`), then the quizzes list containing `Test Quiz`. No errors.

- [ ] **Step 3: Commit**

```bash
git add server/db.js
git commit -m "Add SQLite persistence for quizzes and results"
```

---

### Task 4: In-memory room state machine

**Files:**
- Create: `server/rooms.js`

**Interfaces:**
- Consumes: `computeScore` from `server/scoring.js` (Task 2).
- Produces:
  - `createRoom(quizId, questions) -> roomCode: string`
  - `getRoomState(roomCode) -> room | undefined`
  - `joinRoom(roomCode, playerId, nickname) -> { ok: true } | { ok: false, error }`
  - `lobbySnapshot(roomCode) -> { count, participants: [nickname] }`
  - `startQuestion(roomCode, onReveal: (payload) => void) -> { index, total, text, options, timeLimitSeconds, deadline } | null` (null means the quiz is over)
  - `submitAnswer(roomCode, playerId, questionIndex, optionIndex) -> { ok: true } | { ok: false, error }`
  - `getFinal(roomCode) -> { leaderboard: [{nickname, score}], winner: string | null }`

  `onReveal` is invoked with `{ index, correctIndex, leaderboard }` either when the question's timer expires or when every current player has answered — both paths funnel through the same `triggerReveal` function. Used by `socket.js` (Task 5).

- [ ] **Step 1: Write `server/rooms.js`**

```js
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
```

- [ ] **Step 2: Manually verify the state machine end to end**

Run:
```bash
node -e "
const rooms = require('./server/rooms');
const questions = [{ text: 'Q1', options: ['a','b','c','d'], correctIndex: 0, timeLimitSeconds: 5 }];
const code = rooms.createRoom(1, questions);
console.log('room', code);
console.log(rooms.joinRoom(code, 'p1', 'Alice'));
console.log(rooms.joinRoom(code, 'p2', 'Bob'));
console.log(rooms.lobbySnapshot(code));
const q = rooms.startQuestion(code, (payload) => console.log('REVEAL', JSON.stringify(payload)));
console.log('question', q);
console.log(rooms.submitAnswer(code, 'p1', 0, 0));
console.log(rooms.submitAnswer(code, 'p2', 0, 1));
console.log('final', rooms.getFinal(code));
"
```
Expected: both joins `{ ok: true }`; lobby snapshot shows count 2; `REVEAL` logs before the process exits (since both players answered immediately, all-answered path fires synchronously) with Alice scoring ~1000 and Bob scoring 0; final leaderboard has Alice first.

- [ ] **Step 3: Commit**

```bash
git add server/rooms.js
git commit -m "Add in-memory quiz session state machine"
```

---

### Task 5: Socket.IO wiring

**Files:**
- Create: `server/socket.js`
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `server/db.js` (Task 3), `server/rooms.js` (Task 4).
- Produces: the Socket.IO event contract every frontend page depends on (Tasks 7 and 8):
  - Host emits (with ack callback): `hostLogin(password, cb)`, `listQuizzes(cb)`, `createQuiz({title}, cb)`, `addQuestion({quizId, text, options, correctIndex, timeLimitSeconds}, cb)`, `getQuiz({quizId}, cb)`, `startSession({quizId}, cb)`, `hostNext({roomCode}, cb)`.
  - Participant emits: `joinRoom({roomCode, nickname}, cb)`, `submitAnswer({roomCode, questionIndex, optionIndex}, cb)`.
  - Server broadcasts to room: `lobbyUpdate`, `questionStart`, `reveal`, `final` (payload shapes as returned by `rooms.js`).

- [ ] **Step 1: Write `server/socket.js`**

```js
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
```

- [ ] **Step 2: Wire it into `server/index.js`**

```js
const path = require('path')
const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const { registerSocketHandlers } = require('./socket')

const app = express()
app.use(express.static(path.join(__dirname, '..', 'public')))

const server = http.createServer(app)
const io = new Server(server)
registerSocketHandlers(io)

const PORT = process.env.PORT || 3000
server.listen(PORT, () => console.log(`Quiz server listening on port ${PORT}`))

module.exports = server
```

- [ ] **Step 3: Manually verify with a Socket.IO client script**

Run:
```bash
npm install --no-save socket.io-client
node server/index.js &
sleep 1
node -e "
const { io } = require('socket.io-client');
const s = io('http://localhost:3000');
s.on('connect', () => {
  s.emit('hostLogin', 'quiz', (res) => {
    console.log('login', res);
    s.emit('createQuiz', { title: 'Smoke Test' }, ({ quiz }) => {
      s.emit('addQuestion', { quizId: quiz.id, text: 'Q1', options: ['a','b','c','d'], correctIndex: 0, timeLimitSeconds: 5 }, () => {
        s.emit('startSession', { quizId: quiz.id }, (res2) => {
          console.log('session', res2);
          process.exit(0);
        });
      });
    });
  });
});
"
kill %1
```
Expected: `login { ok: true }` then `session { ok: true, roomCode: '######' }`, no errors.

- [ ] **Step 4: Commit**

```bash
git add server/socket.js server/index.js
git commit -m "Wire Socket.IO events to rooms and db"
```

---

### Task 6: Shared frontend styling

**Files:**
- Create: `public/style.css`

- [ ] **Step 1: Write `public/style.css`**

```css
body { font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 1rem; }
button { padding: 0.75rem 1rem; margin: 0.25rem 0; display: block; width: 100%; font-size: 1rem; }
input, select { padding: 0.5rem; margin: 0.25rem 0; width: 100%; font-size: 1rem; box-sizing: border-box; }
.error { color: #c00; }
#options button { text-align: left; }
li { margin: 0.25rem 0; }
```

- [ ] **Step 2: Remove the Task 1 placeholder**

Run: `rm public/index.html`

- [ ] **Step 3: Commit**

```bash
git add -A public/style.css
git commit -m "Add shared frontend styling"
```

---

### Task 7: Host dashboard + live control view

**Files:**
- Create: `public/host.html`
- Create: `public/host.js`

**Interfaces:**
- Consumes: the Socket.IO events produced in Task 5.

- [ ] **Step 1: Write `public/host.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Quiz Host</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="login">
    <h1>Host Login</h1>
    <input id="password" type="password" placeholder="Host password">
    <button id="loginBtn">Login</button>
    <p id="loginError" class="error"></p>
  </div>

  <div id="dashboard" hidden>
    <h1>Quizzes</h1>
    <ul id="quizList"></ul>
    <h2>Create quiz</h2>
    <input id="newQuizTitle" placeholder="Quiz title">
    <button id="createQuizBtn">Create</button>

    <div id="quizEditor" hidden>
      <h2 id="quizEditorTitle"></h2>
      <div id="questionList"></div>
      <h3>Add question</h3>
      <input id="qText" placeholder="Question text">
      <input id="qOpt0" placeholder="Option 1">
      <input id="qOpt1" placeholder="Option 2">
      <input id="qOpt2" placeholder="Option 3">
      <input id="qOpt3" placeholder="Option 4">
      <select id="qCorrect">
        <option value="0">Option 1 correct</option>
        <option value="1">Option 2 correct</option>
        <option value="2">Option 3 correct</option>
        <option value="3">Option 4 correct</option>
      </select>
      <input id="qTime" type="number" value="20" placeholder="Time limit (seconds)">
      <button id="addQuestionBtn">Add question</button>
      <button id="startSessionBtn">Start session</button>
    </div>
  </div>

  <div id="live" hidden>
    <h1>Room code: <span id="roomCode"></span></h1>
    <div id="lobbyView">
      <p><span id="playerCount">0</span> joined</p>
      <ul id="playerList"></ul>
      <button id="nextBtn">Start quiz</button>
    </div>
    <div id="questionView" hidden>
      <p>Question <span id="qIndex"></span> of <span id="qTotal"></span> is live.</p>
    </div>
    <div id="revealView" hidden>
      <h2>Leaderboard</h2>
      <ol id="leaderboard"></ol>
      <button id="nextBtn2">Next question</button>
    </div>
    <div id="finalView" hidden>
      <h2>Winner: <span id="winner"></span></h2>
      <ol id="finalLeaderboard"></ol>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="host.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/host.js`**

```js
const socket = io()
let currentQuizId = null
let currentRoomCode = null

const el = (id) => document.getElementById(id)

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
    el('questionList').innerHTML = questions.map(q => `<p>${q.text}</p>`).join('')
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
  el('playerList').innerHTML = participants.map(n => `<li>${n}</li>`).join('')
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
  el('leaderboard').innerHTML = leaderboard.map(p => `<li>${p.nickname}: ${p.score}</li>`).join('')
})

socket.on('final', ({ leaderboard, winner }) => {
  el('revealView').hidden = true
  el('finalView').hidden = false
  el('winner').textContent = winner
  el('finalLeaderboard').innerHTML = leaderboard.map(p => `<li>${p.nickname}: ${p.score}</li>`).join('')
})
```

- [ ] **Step 3: Manually verify in a browser**

Run: `node server/index.js`, open `http://localhost:3000/host.html`.
Expected: log in with password `quiz` (or `$HOST_PASSWORD`), create a quiz, add a question, click "Start session" and see a room code and the lobby view.

- [ ] **Step 4: Commit**

```bash
git add public/host.html public/host.js
git commit -m "Add host dashboard and live control view"
```

---

### Task 8: Participant join + play view

**Files:**
- Create: `public/play.html`
- Create: `public/play.js`

**Interfaces:**
- Consumes: the Socket.IO events produced in Task 5.

- [ ] **Step 1: Write `public/play.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Join Quiz</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="joinView">
    <h1>Join Quiz</h1>
    <input id="roomCodeInput" placeholder="Room code">
    <input id="nickname" placeholder="Nickname">
    <button id="joinBtn">Join</button>
    <p id="joinError" class="error"></p>
  </div>

  <div id="waitingView" hidden>
    <p>Waiting for the host to start...</p>
  </div>

  <div id="questionView" hidden>
    <p><span id="qIndex"></span> / <span id="qTotal"></span></p>
    <p id="qText"></p>
    <p>Time left: <span id="timeLeft"></span>s</p>
    <div id="options"></div>
    <p id="lockedMsg" hidden>Answer locked in!</p>
  </div>

  <div id="revealView" hidden>
    <h2 id="resultMsg"></h2>
    <p>Your score so far: <span id="myScore"></span></p>
  </div>

  <div id="finalView" hidden>
    <h2>Final ranking</h2>
    <ol id="finalLeaderboard"></ol>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="play.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/play.js`**

```js
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
```

- [ ] **Step 3: Manually verify in a browser**

Run: with the server still running, open `http://localhost:3000/play.html` in a second tab, join using the room code from Task 7's verification with a nickname, confirm the "waiting" screen shows.

- [ ] **Step 4: Commit**

```bash
git add public/play.html public/play.js
git commit -m "Add participant join and play view"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the server**

Run: `HOST_PASSWORD=quiz node server/index.js`

- [ ] **Step 2: Play a full quiz across three browser tabs**

1. Tab A (`http://localhost:3000/host.html`): log in, create a quiz titled "Demo", add two questions (e.g. "2+2?" with options `3/4/5/6`, correct `1`, 10s; "Capital of France?" with options `Paris/Rome/Berlin/Madrid`, correct `0`, 10s), click "Start session", note the room code.
2. Tab B and Tab C (`http://localhost:3000/play.html`): join with the room code as "Alice" and "Bob".
3. In Tab A, verify the lobby shows `2 joined` with both names, then click "Start quiz".
4. In Tabs B/C, verify each shows the question text, 4 options, and a counting-down timer; answer one correctly and one incorrectly (or at different speeds) before the timer runs out.
5. Verify Tab A automatically shows the leaderboard once both have answered (or the timer expires), with the correct player scoring higher.
6. Click "Next question" in Tab A, repeat for question 2.
7. After the last question's leaderboard, click "Next question" again and verify Tab A shows a winner, and Tabs B/C show the final ranking.

Expected: no console errors in any tab; leaderboard/final scores match the scoring rule (faster correct answers score higher, wrong answers score 0); winner is the highest scorer.

- [ ] **Step 3: Verify results were persisted**

Run:
```bash
node -e "
const db = require('better-sqlite3')('data/quiz.db');
console.log(db.prepare('SELECT * FROM results').all());
"
```
Expected: one row per participant for the "Demo" quiz's session code, with `total_score` matching what was shown in the final ranking.

No commit for this task — it's verification only.

---

## Self-Review Notes

- **Spec coverage:** roles/screens (Tasks 7–8), session state machine (Task 4), scoring formula (Task 2), data model (Task 3), error handling — duplicate nickname and no-mid-quiz-join (Task 4's `joinRoom`), host-disconnect-pauses-session (a natural consequence of `hostNext` being the only phase-advancing action — no extra code needed), testing scope (Task 2) — all covered. The "participant reconnect mid-question" edge case from the spec is intentionally simplified to "no rejoin after lobby closes," flagged with a `ponytail:` comment in `rooms.js` rather than implemented, since building real session resumption is disproportionate to a single-event tool; call it out if reconnect turns out to matter in practice.
- **Placeholder scan:** none found — every step has runnable code or a concrete verification command.
- **Type consistency:** `computeScore({correct, remainingMs, limitMs})` (Task 2) matches its call in `rooms.js` (Task 4); the `{index, total, text, options, timeLimitSeconds, deadline}` question payload and `{index, correctIndex, leaderboard}` reveal payload are used identically in `socket.js` (Task 5), `host.js` (Task 7), and `play.js` (Task 8).
