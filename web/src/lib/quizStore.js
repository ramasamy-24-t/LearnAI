import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'

function jsonb(value) {
  if (value == null) return Prisma.sql`NULL`
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return Prisma.sql`CAST(${text} AS JSONB)`
}

let ready = false

export async function ensureQuizTables() {
  if (ready) return
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      teacher_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      board_id INT NULL,
      grade_id INT NOT NULL,
      grade_label VARCHAR(128) NOT NULL,
      subject_id INT NULL,
      subject_label VARCHAR(128) NOT NULL,
      curriculum_unit_id INT NULL,
      lesson_title VARCHAR(255) NOT NULL,
      topic_id INT NULL,
      topic_title VARCHAR(255) NULL,
      difficulty VARCHAR(32) NOT NULL DEFAULT 'beginner',
      question_count INT NOT NULL DEFAULT 5,
      status VARCHAR(24) NOT NULL DEFAULT 'draft',
      published_at TIMESTAMP NULL,
      insights_json JSONB NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS quizzes_teacher_status ON quizzes (teacher_id, status)
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS quizzes_grade_status ON quizzes (grade_id, status)
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id SERIAL PRIMARY KEY,
      quiz_id INT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      type VARCHAR(24) NOT NULL DEFAULT 'mcq',
      prompt TEXT NOT NULL,
      options JSONB NULL,
      correct_answer TEXT NOT NULL,
      explanation TEXT NOT NULL,
      topic_title VARCHAR(255) NULL,
      misconception_hint TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS quiz_questions_quiz_sort ON quiz_questions (quiz_id, sort_order)
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id SERIAL PRIMARY KEY,
      quiz_id INT NOT NULL,
      student_id INT NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'in_progress',
      current_index INT NOT NULL DEFAULT 0,
      started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL,
      score_percent DECIMAL(5,2) NULL,
      correct_count INT NOT NULL DEFAULT 0,
      total_time_ms INT NOT NULL DEFAULT 0,
      summary_json JSONB NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (quiz_id, student_id)
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS quiz_attempts_student_status ON quiz_attempts (student_id, status)
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
      id SERIAL PRIMARY KEY,
      attempt_id INT NOT NULL,
      question_id INT NOT NULL,
      first_answer TEXT NULL,
      first_is_correct BOOLEAN NULL,
      latest_answer TEXT NULL,
      is_correct BOOLEAN NOT NULL DEFAULT false,
      time_ms INT NOT NULL DEFAULT 0,
      hint_count INT NOT NULL DEFAULT 0,
      incorrect_attempts INT NOT NULL DEFAULT 0,
      revealed BOOLEAN NOT NULL DEFAULT false,
      misconception VARCHAR(500) NULL,
      tutor_thread JSONB NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (attempt_id, question_id)
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS student_learning_recs (
      id SERIAL PRIMARY KEY,
      student_id INT NOT NULL,
      teacher_id INT NOT NULL,
      quiz_id INT NULL,
      subject VARCHAR(128) NOT NULL,
      lesson VARCHAR(255) NULL,
      topic VARCHAR(255) NULL,
      reason TEXT NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'open',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS student_learning_recs_student ON student_learning_recs (student_id, status)
  `)
  for (const table of ['quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_attempt_answers']) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE ${table}
        ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
        ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP
    `)
    await prisma.$executeRawUnsafe(`
      UPDATE ${table}
      SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
      WHERE updated_at IS NULL
    `)
  }
  ready = true
}

function asJson(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

function bool(value) {
  if (value == null) return null
  return Boolean(Number(value) || value === true)
}

export function mapQuiz(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    teacherId: Number(row.teacher_id),
    title: row.title,
    boardId: row.board_id == null ? null : Number(row.board_id),
    gradeId: Number(row.grade_id),
    gradeLabel: row.grade_label,
    subjectId: row.subject_id == null ? null : Number(row.subject_id),
    subjectLabel: row.subject_label,
    curriculumUnitId: row.curriculum_unit_id == null ? null : Number(row.curriculum_unit_id),
    lessonTitle: row.lesson_title,
    topicId: row.topic_id == null ? null : Number(row.topic_id),
    topicTitle: row.topic_title,
    difficulty: row.difficulty,
    questionCount: Number(row.question_count),
    status: row.status,
    publishedAt: row.published_at,
    insightsJson: asJson(row.insights_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapQuestion(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    quizId: Number(row.quiz_id),
    sortOrder: Number(row.sort_order),
    type: row.type,
    prompt: row.prompt,
    options: asJson(row.options) || [],
    correctAnswer: row.correct_answer,
    explanation: row.explanation,
    topicTitle: row.topic_title,
    misconceptionHint: row.misconception_hint,
  }
}

export function mapAttempt(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    quizId: Number(row.quiz_id),
    studentId: Number(row.student_id),
    status: row.status,
    currentIndex: Number(row.current_index),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    scorePercent: row.score_percent == null ? null : Number(row.score_percent),
    correctCount: Number(row.correct_count),
    totalTimeMs: Number(row.total_time_ms),
    summaryJson: asJson(row.summary_json),
  }
}

export function mapAnswer(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    attemptId: Number(row.attempt_id),
    questionId: Number(row.question_id),
    firstAnswer: row.first_answer,
    firstIsCorrect: row.first_is_correct == null ? null : bool(row.first_is_correct),
    latestAnswer: row.latest_answer,
    isCorrect: bool(row.is_correct),
    timeMs: Number(row.time_ms || 0),
    hintCount: Number(row.hint_count || 0),
    incorrectAttempts: Number(row.incorrect_attempts || 0),
    revealed: bool(row.revealed),
    misconception: row.misconception,
    tutorThread: asJson(row.tutor_thread) || [],
  }
}

export async function insertQuiz(data) {
  await ensureQuizTables()
  await prisma.$executeRaw`
    INSERT INTO quizzes (
      teacher_id, title, board_id, grade_id, grade_label, subject_id, subject_label,
      curriculum_unit_id, lesson_title, topic_id, topic_title, difficulty, question_count, status
    ) VALUES (
      ${data.teacherId}, ${data.title}, ${data.boardId}, ${data.gradeId}, ${data.gradeLabel},
      ${data.subjectId}, ${data.subjectLabel}, ${data.curriculumUnitId}, ${data.lessonTitle},
      ${data.topicId}, ${data.topicTitle}, ${data.difficulty}, ${data.questionCount}, ${data.status || 'draft'}
    )
  `
  const rows = await prisma.$queryRaw`SELECT id FROM quizzes WHERE teacher_id = ${data.teacherId} ORDER BY id DESC LIMIT 1`
  return Number(rows[0].id)
}

export async function insertQuestion(quizId, q, sortOrder) {
  await ensureQuizTables()
  const options = JSON.stringify(q.options || [])
  await prisma.$executeRaw`
    INSERT INTO quiz_questions (
      quiz_id, sort_order, type, prompt, options, correct_answer, explanation, topic_title, misconception_hint
    ) VALUES (
      ${quizId}, ${sortOrder}, ${q.type}, ${q.prompt}, ${jsonb(options)},
      ${q.correctAnswer}, ${q.explanation}, ${q.topicTitle}, ${q.misconceptionHint}
    )
  `
  const rows = await prisma.$queryRaw`SELECT id FROM quiz_questions WHERE quiz_id = ${quizId} ORDER BY id DESC LIMIT 1`
  return Number(rows[0].id)
}

export async function getQuiz(id) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`SELECT * FROM quizzes WHERE id = ${Number(id)} LIMIT 1`
  return mapQuiz(rows[0])
}

export async function getQuizQuestions(quizId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`SELECT * FROM quiz_questions WHERE quiz_id = ${Number(quizId)} ORDER BY sort_order ASC, id ASC`
  return rows.map(mapQuestion)
}

export async function getQuestion(id) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`SELECT * FROM quiz_questions WHERE id = ${Number(id)} LIMIT 1`
  return mapQuestion(rows[0])
}

export async function listTeacherQuizzes(teacherId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`SELECT * FROM quizzes WHERE teacher_id = ${Number(teacherId)} ORDER BY created_at DESC`
  return rows.map(mapQuiz)
}

export async function listPublishedByGrade(gradeId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`
    SELECT * FROM quizzes WHERE status = 'published' AND grade_id = ${Number(gradeId)} ORDER BY published_at DESC
  `
  return rows.map(mapQuiz)
}

export async function deleteQuiz(id) {
  await ensureQuizTables()
  const qid = Number(id)
  const attempts = await listAttemptsForQuiz(qid)
  for (const a of attempts) {
    await prisma.$executeRaw`DELETE FROM quiz_attempt_answers WHERE attempt_id = ${a.id}`
  }
  await prisma.$executeRaw`DELETE FROM quiz_attempts WHERE quiz_id = ${qid}`
  await prisma.$executeRaw`DELETE FROM quiz_questions WHERE quiz_id = ${qid}`
  await prisma.$executeRaw`UPDATE student_learning_recs SET quiz_id = NULL WHERE quiz_id = ${qid}`
  await prisma.$executeRaw`DELETE FROM quizzes WHERE id = ${qid}`
}

export async function updateQuizFields(id, { title, difficulty, status, questionCount, publishedAt, insightsJson }) {
  await ensureQuizTables()
  const quiz = await getQuiz(id)
  if (!quiz) return null
  const nextTitle = title ?? quiz.title
  const nextDiff = difficulty ?? quiz.difficulty
  const nextStatus = status ?? quiz.status
  const nextCount = questionCount ?? quiz.questionCount
  const nextPublished = publishedAt === undefined ? quiz.publishedAt : publishedAt
  const insightsStr = insightsJson === undefined
    ? (quiz.insightsJson == null ? null : JSON.stringify(quiz.insightsJson))
    : (insightsJson == null ? null : JSON.stringify(insightsJson))
  await prisma.$executeRaw`
    UPDATE quizzes SET
      title = ${nextTitle},
      difficulty = ${nextDiff},
      status = ${nextStatus},
      question_count = ${nextCount},
      published_at = ${nextPublished},
      insights_json = ${jsonb(insightsStr)}
    WHERE id = ${Number(id)}
  `
  return getQuiz(id)
}

export async function updateQuestionRow(id, data) {
  await ensureQuizTables()
  const q = await getQuestion(id)
  if (!q) return null
  const options = JSON.stringify(data.options ?? q.options ?? [])
  await prisma.$executeRaw`
    UPDATE quiz_questions SET
      type = ${data.type ?? q.type},
      prompt = ${data.prompt ?? q.prompt},
      options = ${jsonb(options)},
      correct_answer = ${data.correctAnswer ?? q.correctAnswer},
      explanation = ${data.explanation ?? q.explanation},
      topic_title = ${data.topicTitle ?? q.topicTitle}
    WHERE id = ${Number(id)}
  `
  return getQuestion(id)
}

export async function deleteQuestionRow(id) {
  await ensureQuizTables()
  await prisma.$executeRaw`DELETE FROM quiz_attempt_answers WHERE question_id = ${Number(id)}`
  await prisma.$executeRaw`DELETE FROM quiz_questions WHERE id = ${Number(id)}`
}

export async function getAttempt(id) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`SELECT * FROM quiz_attempts WHERE id = ${Number(id)} LIMIT 1`
  return mapAttempt(rows[0])
}

export async function getAttemptByQuizStudent(quizId, studentId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`
    SELECT * FROM quiz_attempts WHERE quiz_id = ${Number(quizId)} AND student_id = ${Number(studentId)} LIMIT 1
  `
  return mapAttempt(rows[0])
}

export async function listAttemptsForQuizzes(quizIds) {
  await ensureQuizTables()
  if (!quizIds.length) return []
  const rows = await prisma.$queryRawUnsafe(
    `SELECT quiz_id, status FROM quiz_attempts WHERE quiz_id IN (${quizIds.map((id) => Number(id)).join(',')})`,
  )
  return rows.map((r) => ({ quizId: Number(r.quiz_id), status: r.status }))
}

export async function listAttemptsForQuiz(quizId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`SELECT * FROM quiz_attempts WHERE quiz_id = ${Number(quizId)}`
  return rows.map(mapAttempt)
}

export async function listStudentAttempts(studentId, quizIds) {
  await ensureQuizTables()
  if (!quizIds.length) return []
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM quiz_attempts WHERE student_id = ${Number(studentId)} AND quiz_id IN (${quizIds.map((id) => Number(id)).join(',')})`,
  )
  return rows.map(mapAttempt)
}

export async function createAttempt(quizId, studentId) {
  await ensureQuizTables()
  await prisma.$executeRaw`
    INSERT INTO quiz_attempts (quiz_id, student_id, status) VALUES (${Number(quizId)}, ${Number(studentId)}, 'in_progress')
  `
  return getAttemptByQuizStudent(quizId, studentId)
}

export async function listAnswers(attemptId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`SELECT * FROM quiz_attempt_answers WHERE attempt_id = ${Number(attemptId)}`
  return rows.map(mapAnswer)
}

export async function getAnswer(attemptId, questionId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`
    SELECT * FROM quiz_attempt_answers WHERE attempt_id = ${Number(attemptId)} AND question_id = ${Number(questionId)} LIMIT 1
  `
  return mapAnswer(rows[0])
}

export async function saveAnswer(row) {
  await ensureQuizTables()
  const thread = JSON.stringify(row.tutorThread || [])
  const existing = await getAnswer(row.attemptId, row.questionId)
  if (!existing) {
    await prisma.$executeRaw`
      INSERT INTO quiz_attempt_answers (
        attempt_id, question_id, first_answer, first_is_correct, latest_answer, is_correct,
        time_ms, hint_count, incorrect_attempts, revealed, misconception, tutor_thread,
        created_at, updated_at
      ) VALUES (
        ${row.attemptId}, ${row.questionId}, ${row.firstAnswer}, ${row.firstIsCorrect == null ? null : row.firstIsCorrect},
        ${row.latestAnswer}, ${row.isCorrect}, ${row.timeMs || 0}, ${row.hintCount || 0},
        ${row.incorrectAttempts || 0}, ${row.revealed}, ${row.misconception || null}, ${jsonb(thread)},
        NOW(), NOW()
      )
    `
    return getAnswer(row.attemptId, row.questionId)
  }
  await prisma.$executeRaw`
    UPDATE quiz_attempt_answers SET
      first_answer = ${row.firstAnswer ?? existing.firstAnswer},
      first_is_correct = ${row.firstIsCorrect == null ? existing.firstIsCorrect : row.firstIsCorrect},
      latest_answer = ${row.latestAnswer ?? existing.latestAnswer},
      is_correct = ${row.isCorrect},
      time_ms = ${row.timeMs ?? existing.timeMs},
      hint_count = ${row.hintCount ?? existing.hintCount},
      incorrect_attempts = ${row.incorrectAttempts ?? existing.incorrectAttempts},
      revealed = ${row.revealed},
      misconception = ${row.misconception ?? existing.misconception},
      tutor_thread = ${jsonb(thread)},
      updated_at = NOW()
    WHERE id = ${existing.id}
  `
  return getAnswer(row.attemptId, row.questionId)
}

export async function updateAttempt(id, fields) {
  await ensureQuizTables()
  const a = await getAttempt(id)
  if (!a) return null
  const summary = fields.summaryJson === undefined
    ? (a.summaryJson == null ? null : JSON.stringify(a.summaryJson))
    : JSON.stringify(fields.summaryJson)
  await prisma.$executeRaw`
    UPDATE quiz_attempts SET
      status = ${fields.status ?? a.status},
      current_index = ${fields.currentIndex ?? a.currentIndex},
      completed_at = ${fields.completedAt === undefined ? a.completedAt : fields.completedAt},
      score_percent = ${fields.scorePercent === undefined ? a.scorePercent : fields.scorePercent},
      correct_count = ${fields.correctCount ?? a.correctCount},
      total_time_ms = ${fields.totalTimeMs ?? a.totalTimeMs},
      summary_json = ${jsonb(summary)},
      updated_at = NOW()
    WHERE id = ${Number(id)}
  `
  return getAttempt(id)
}

export async function insertLearningRec(data) {
  await ensureQuizTables()
  await prisma.$executeRaw`
    INSERT INTO student_learning_recs (student_id, teacher_id, quiz_id, subject, lesson, topic, reason, status)
    VALUES (${data.studentId}, ${data.teacherId}, ${data.quizId}, ${data.subject}, ${data.lesson}, ${data.topic}, ${data.reason}, 'open')
  `
}

export async function listLearningRecs(studentId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`
    SELECT * FROM student_learning_recs WHERE student_id = ${Number(studentId)} AND status = 'open' ORDER BY created_at DESC LIMIT 8
  `
  return rows.map((r) => ({
    id: Number(r.id),
    subject: r.subject,
    lesson: r.lesson,
    topic: r.topic,
    reason: r.reason,
    createdAt: r.created_at,
  }))
}

export async function dismissLearningRec(id, studentId) {
  await ensureQuizTables()
  const count = await prisma.$executeRaw`
    UPDATE student_learning_recs
    SET status = 'dismissed'
    WHERE id = ${Number(id)} AND student_id = ${Number(studentId)} AND status = 'open'
  `
  return Number(count) > 0
}

export async function dismissAllLearningRecs(studentId) {
  await ensureQuizTables()
  await prisma.$executeRaw`
    UPDATE student_learning_recs
    SET status = 'dismissed'
    WHERE student_id = ${Number(studentId)} AND status = 'open'
  `
}

export async function listTeacherStudentAttempts(teacherId, studentId) {
  await ensureQuizTables()
  const rows = await prisma.$queryRaw`
    SELECT a.*, q.title, q.subject_label, q.lesson_title
    FROM quiz_attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    WHERE a.student_id = ${Number(studentId)} AND q.teacher_id = ${Number(teacherId)} AND a.status = 'completed'
    ORDER BY a.completed_at ASC
  `
  return rows.map((r) => ({
    ...mapAttempt(r),
    quizTitle: r.title,
    subjectLabel: r.subject_label,
    lessonTitle: r.lesson_title,
  }))
}
