const path = require('path')
const fs = require('node:fs')
const { DatabaseSync } = require('node:sqlite')

const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'quiz.db'))

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

function deleteQuiz(quizId) {
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM results WHERE quiz_id = ?').run(quizId)
    db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(quizId)
    db.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function updateQuestion(questionId, { text, options, correctIndex, timeLimitSeconds }) {
  db.prepare(`
    UPDATE questions SET text = ?, option1 = ?, option2 = ?, option3 = ?, option4 = ?, correct_index = ?, time_limit_seconds = ?
    WHERE id = ?
  `).run(text, options[0], options[1], options[2], options[3], correctIndex, timeLimitSeconds, questionId)
  return { id: questionId, text, options, correctIndex, timeLimitSeconds }
}

function saveResults(quizId, sessionCode, leaderboard) {
  const insert = db.prepare('INSERT INTO results (quiz_id, session_code, nickname, total_score, played_at) VALUES (?, ?, ?, ?, ?)')
  const now = Date.now()
  db.exec('BEGIN')
  try {
    for (const row of leaderboard) insert.run(quizId, sessionCode, row.nickname, row.score, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

module.exports = { createQuiz, addQuestion, listQuizzes, getQuizWithQuestions, saveResults, deleteQuiz, updateQuestion }
