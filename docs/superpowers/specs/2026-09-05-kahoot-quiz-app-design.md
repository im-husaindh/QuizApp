# Live Quiz App (Kahoot-style) — Design

## Purpose

A web app for running live, timed multiple-choice quizzes with up to ~500
simultaneous participants. One host runs a session; participants join from
their phones with a nickname and room code; scoring rewards both correctness
and speed, with a leaderboard shown after every question and a winner
revealed at the end.

## Scale & constraints

- ~500 concurrent participants, single event at a time (one active session
  is the primary use case; the design does not preclude multiple concurrent
  rooms, since state is keyed by room code).
- Single Node.js server process is sufficient at this scale — no horizontal
  scaling, no external pub/sub.
- Host is a single trusted organizer per event, gated by one shared
  password (not per-user accounts).

## Tech stack

- **Server**: Node.js + Express + Socket.IO (WebSockets with built-in
  reconnection — needed for ~500 phones on venue wifi).
- **Persistence**: SQLite via `better-sqlite3` (no ORM). Stores quiz
  definitions and finished-session results only.
- **Live session state**: in-memory (`Map<roomCode, SessionState>`) on the
  server. Not persisted — a server crash mid-quiz loses the live game, which
  is an acceptable trade-off for a live-event tool. Quiz definitions and
  final results survive restarts.
- **Frontend**: plain HTML/CSS/JS, no build step, no framework. Three
  static pages: host dashboard, host/big-screen live view, participant
  view.

## Roles & screens

- **Host dashboard** (password-gated): create/edit quizzes (question text,
  4 options, correct index, per-question time limit in seconds), pick a
  quiz, start a session to get a room code, watch the lobby fill up, advance
  through questions, view the leaderboard between questions, end on a final
  winner screen.
- **Participant view**: enter nickname + room code → lobby (waiting) →
  each question shows its own text, 4 options, and a countdown timer,
  self-contained (no dependency on a shared screen) → submits one answer,
  then locked → sees own result/rank after each question → final ranking at
  the end.

## Session flow (state machine, per room)

```
lobby -> question(n) -> reveal/leaderboard(n) -> question(n+1) -> ... -> final
```

- **lobby**: participants join with a nickname (validated unique within the
  room). Host screen updates participant count/list live via broadcast.
- **question(n)**: server pushes question text, options, and an absolute
  deadline timestamp to all participants and the host simultaneously. Each
  participant may submit one answer; the server timestamps receipt itself
  (never trusts a client-reported time) and rejects further submissions
  from that participant for this question.
- **reveal(n)**: triggered when the timer expires or all participants have
  answered. Server computes correctness and score per participant, updates
  cumulative totals, and broadcasts the leaderboard (top N plus each
  player's own rank) to host and participants.
- **final**: after the last question's reveal, broadcast full final
  rankings; the host screen highlights the winner.
- Host advances lobby -> question(1) and reveal(n) -> question(n+1)
  manually (a "next" action) so the host controls pacing; the
  question -> reveal transition inside a question is automatic (timer or
  all-answered).

## Scoring

Kahoot-style speed scoring, computed server-side from the server-received
answer timestamp (immune to client clock skew):

- Wrong answer, or no answer submitted before the deadline: **0 points**.
- Correct answer: `500 + 500 * (remaining_ms / limit_ms)`, rounded to the
  nearest integer. An instant correct answer scores ~1000; a correct answer
  submitted right at the deadline scores ~500.
- Per-question scores accumulate into a running total per participant,
  which is what the leaderboard and final ranking sort on.

## Data model (SQLite)

- `quizzes(id, title, created_at)`
- `questions(id, quiz_id, text, option1, option2, option3, option4,
  correct_index, time_limit_seconds, sort_order)`
- `results(id, quiz_id, session_code, nickname, total_score, played_at)`

No per-question answer audit log is stored — only the final per-participant
total per session. Live in-progress state (who's connected, current
question index, per-question answer records used to compute scoring) lives
only in server memory for the duration of the session.

## Error handling / edge cases

- **Duplicate nickname** in a room: server rejects the join and asks for a
  different nickname.
- **Participant disconnect/reconnect** mid-question: Socket.IO's session
  resumption rejoins them to the same room and current phase within its
  reconnection window; outside that window they rejoin fresh at the
  current phase (they cannot rejoin into a past question).
- **Late joiners** after a session has left the lobby phase: allowed to
  connect and watch, but cannot answer until the next session — no
  mid-quiz join.
- **Host disconnect**: the session pauses (no further phase transitions,
  though in-flight question timers still run and lock as scheduled) until
  the host reconnects and resumes control. Avoids an orphaned quiz
  advancing with no host present.

## Testing

- One `test_scoring.js`-style assertion script covering the score formula's
  boundary cases: instant correct answer, correct answer at the deadline,
  wrong answer, no answer submitted. This is the only piece of non-trivial
  logic in the system; no test framework or end-to-end suite is warranted
  at this scope.

## Out of scope (YAGNI)

- Multi-tenant accounts/auth beyond a single shared host password.
- Per-question answer audit trail / analytics.
- Horizontal scaling, Redis, or multi-server session sharing.
- Question banks shared across organizations, quiz import/export formats.
