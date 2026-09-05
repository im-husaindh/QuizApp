const path = require('path')
const fs = require('node:fs')

const USE_TURSO = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)

const SCHEMA = `
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
`

// run/get/all/runBatch are the only points where the two backends differ --
// every function below this point is backend-agnostic business logic.
let run, get, all, runBatch, ready

if (USE_TURSO) {
  // Render's free tier has no persistent disk -- the whole filesystem resets
  // on every spin-down/redeploy. Turso is a free, network-hosted, SQLite-
  // compatible database, so quizzes/results survive that.
  const { createClient } = require('@libsql/client')
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  })

  const rowToObject = (rs, row) => {
    const obj = {}
    rs.columns.forEach((col, i) => { obj[col] = row[i] })
    return obj
  }

  run = async (sql, args = []) => {
    const rs = await client.execute({ sql, args })
    return { lastInsertRowid: Number(rs.lastInsertRowid), changes: rs.rowsAffected }
  }
  get = async (sql, args = []) => {
    const rs = await client.execute({ sql, args })
    return rs.rows[0] ? rowToObject(rs, rs.rows[0]) : undefined
  }
  all = async (sql, args = []) => {
    const rs = await client.execute({ sql, args })
    return rs.rows.map((row) => rowToObject(rs, row))
  }
  runBatch = async (statements) => {
    await client.batch(statements.map((s) => ({ sql: s.sql, args: s.args || [] })), 'write')
  }
  ready = client.executeMultiple(SCHEMA)
} else {
  const { DatabaseSync } = require('node:sqlite')
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'quiz.db'))

  run = async (sql, args = []) => {
    const info = db.prepare(sql).run(...args)
    return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes }
  }
  get = async (sql, args = []) => db.prepare(sql).get(...args)
  all = async (sql, args = []) => db.prepare(sql).all(...args)
  runBatch = async (statements) => {
    db.exec('BEGIN')
    try {
      for (const s of statements) db.prepare(s.sql).run(...(s.args || []))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  db.exec(SCHEMA)
  ready = Promise.resolve()
}

async function createQuiz(title) {
  await ready
  const info = await run('INSERT INTO quizzes (title, created_at) VALUES (?, ?)', [title, Date.now()])
  return { id: info.lastInsertRowid, title }
}

async function addQuestion(quizId, { text, options, correctIndex, timeLimitSeconds }) {
  await ready
  const countRow = await get('SELECT COUNT(*) AS n FROM questions WHERE quiz_id = ?', [quizId])
  const sortOrder = countRow.n
  const info = await run(`
    INSERT INTO questions (quiz_id, text, option1, option2, option3, option4, correct_index, time_limit_seconds, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [quizId, text, options[0], options[1], options[2], options[3], correctIndex, timeLimitSeconds, sortOrder])
  return { id: info.lastInsertRowid, quizId, text, options, correctIndex, timeLimitSeconds }
}

async function listQuizzes() {
  await ready
  return all('SELECT id, title FROM quizzes ORDER BY created_at DESC')
}

async function getQuizWithQuestions(quizId) {
  await ready
  const quiz = await get('SELECT id, title FROM quizzes WHERE id = ?', [quizId])
  if (!quiz) return null
  const rows = await all('SELECT * FROM questions WHERE quiz_id = ? ORDER BY sort_order', [quizId])
  const questions = rows.map((r) => ({
    id: r.id,
    text: r.text,
    options: [r.option1, r.option2, r.option3, r.option4],
    correctIndex: r.correct_index,
    timeLimitSeconds: r.time_limit_seconds
  }))
  return { quiz, questions }
}

async function deleteQuiz(quizId) {
  await ready
  await runBatch([
    { sql: 'DELETE FROM results WHERE quiz_id = ?', args: [quizId] },
    { sql: 'DELETE FROM questions WHERE quiz_id = ?', args: [quizId] },
    { sql: 'DELETE FROM quizzes WHERE id = ?', args: [quizId] }
  ])
}

async function updateQuestion(questionId, { text, options, correctIndex, timeLimitSeconds }) {
  await ready
  await run(`
    UPDATE questions SET text = ?, option1 = ?, option2 = ?, option3 = ?, option4 = ?, correct_index = ?, time_limit_seconds = ?
    WHERE id = ?
  `, [text, options[0], options[1], options[2], options[3], correctIndex, timeLimitSeconds, questionId])
  return { id: questionId, text, options, correctIndex, timeLimitSeconds }
}

async function saveResults(quizId, sessionCode, leaderboard) {
  await ready
  const now = Date.now()
  await runBatch(leaderboard.map((row) => ({
    sql: 'INSERT INTO results (quiz_id, session_code, nickname, total_score, played_at) VALUES (?, ?, ?, ?, ?)',
    args: [quizId, sessionCode, row.nickname, row.score, now]
  })))
}

module.exports = { createQuiz, addQuestion, listQuizzes, getQuizWithQuestions, saveResults, deleteQuiz, updateQuestion }
