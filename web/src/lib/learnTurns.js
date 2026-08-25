import { Prisma } from '@prisma/client'
import { prisma } from './prisma.js'
import { chatCompletion } from './openai.js'
import { parseJsonArray } from './http.js'
import { matchTeacherSubject, teacherSubjectList } from './teacherSubjects.js'
import { createBoundedTtlCache } from './cache.js'

function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (value == null || value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toIso(value) {
  const parsed = asDate(value)
  return parsed ? parsed.toISOString() : null
}

let tableReady = false
const insightCache = createBoundedTtlCache({ max: 48, ttlMs: 10 * 60_000 })
let insightCacheTeacherId = null

export function invalidateInsightCache(teacherId) {
  if (teacherId != null && insightCacheTeacherId != null && Number(teacherId) !== insightCacheTeacherId) {
    return
  }
  insightCache.clear()
  insightCacheTeacherId = null
}

export async function ensureLearnTurnsTable() {
  if (tableReady) return
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS learn_turns (
      id SERIAL PRIMARY KEY,
      student_id INT NOT NULL,
      teacher_id INT NOT NULL,
      subject VARCHAR(128) NOT NULL,
      lesson VARCHAR(255) NULL,
      topics JSONB NULL,
      question TEXT NOT NULL,
      answer_preview VARCHAR(500) NULL,
      response_mode VARCHAR(32) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS learn_turns_teacher_created ON learn_turns (teacher_id, created_at)
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS learn_turns_teacher_subject ON learn_turns (teacher_id, subject)
  `)
  tableReady = true
}

function previewAnswer(text) {
  return String(text || '')
    .replace(/[#*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

export async function recordLearnTurn({ studentId, teacherId, subject, lesson, topics, question, answer, responseMode }) {
  const q = String(question || '').trim()
  const teacher = Number(teacherId)
  const student = Number(studentId)
  const subjectLabel = String(subject || '').trim().slice(0, 128)
  if (!q || !teacher || !student || !subjectLabel) return null
  try {
    const profile = await prisma.teacherProfile.findUnique({
      where: { userId: teacher },
      select: { subjects: true },
    })
    const taught = teacherSubjectList({ subjects: parseJsonArray(profile?.subjects) })
    const canonical = matchTeacherSubject(subjectLabel, taught)
    if (!canonical) return null
    await ensureLearnTurnsTable()
    const topicJson = JSON.stringify(
      Array.isArray(topics) ? topics.slice(0, 12).map((t) => String(t).slice(0, 120)) : [],
    )
    await prisma.$executeRaw`
      INSERT INTO learn_turns
        (student_id, teacher_id, subject, lesson, topics, question, answer_preview, response_mode, created_at)
      VALUES
        (${student}, ${teacher}, ${canonical.slice(0, 128)}, ${lesson ? String(lesson).slice(0, 255) : null},
         ${Prisma.sql`CAST(${topicJson} AS JSONB)`}, ${q.slice(0, 8000)}, ${previewAnswer(answer)},
         ${responseMode ? String(responseMode).slice(0, 32) : null}, NOW())
    `
    invalidateInsightCache(teacher)
    return true
  } catch (error) {
    console.error('recordLearnTurn failed', error)
    return null
  }
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function lessonCounts(rows) {
  const map = new Map()
  for (const row of rows) {
    const key = String(row.lesson || '').trim() || 'General'
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .map(([lesson, count]) => ({ lesson, count }))
    .sort((a, b) => b.count - a.count)
}

function topicSet(rows) {
  const set = new Set()
  for (const row of rows) {
    if (row.lesson) set.add(String(row.lesson).trim())
    const extra = parseJsonArray(row.topics)
    extra.forEach((t) => {
      const label = String(t || '').trim()
      if (label) set.add(label)
    })
  }
  return [...set].filter(Boolean).slice(0, 12)
}

function heuristicInsights(subject, rows, todayRows) {
  const insights = []
  const ranked = lessonCounts(rows)
  if (todayRows.length) {
    const todayLessons = lessonCounts(todayRows)
      .slice(0, 3)
      .map((x) => x.lesson)
    insights.push(
      `Self-learned today in ${subject}: ${todayLessons.join(', ') || 'mixed topics'} (${todayRows.length} question${todayRows.length === 1 ? '' : 's'}).`,
    )
  }
  if (ranked[0] && ranked[0].count >= 2) {
    insights.push(
      `Most recurring doubt cluster is “${ranked[0].lesson}” (${ranked[0].count} questions). Plan a short reteach.`,
    )
  }
  const uniqueStudents = new Set(rows.map((r) => r.studentId)).size
  if (uniqueStudents) {
    insights.push(
      `${uniqueStudents} learner${uniqueStudents === 1 ? '' : 's'} asked about ${subject} in Learn mode—watch for the same misconception repeating.`,
    )
  }
  if (ranked[1]) {
    insights.push(`Also coming up often: ${ranked[1].lesson}.`)
  }
  return insights.slice(0, 5)
}

async function llmInsights(subject, rows) {
  const sample = rows.slice(0, 24).map((r) => ({
    lesson: r.lesson || 'General',
    question: String(r.question || '').slice(0, 240),
  }))
  const systemPrompt = `You help a school teacher plan the next class. Return JSON only: {"insights":["...","..."]} with 3 to 5 short bullets. Focus on recurring doubts, likely misconceptions, and what to reteach. Do not invent student names. Stay inside the given subject.`
  const result = await chatCompletion({
    systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Subject: ${subject}\nQuestions:\n${JSON.stringify(sample)}`,
      },
    ],
    maxTokens: 400,
  })
  const raw = String(result.answer || '').trim()
  const jsonText = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
  const parsed = JSON.parse(jsonText)
  const insights = Array.isArray(parsed?.insights)
    ? parsed.insights.map((x) => String(x).trim()).filter(Boolean)
    : []
  return insights.slice(0, 5)
}

export async function buildTeacherInsights(teacherId) {
  await ensureLearnTurnsTable()
  const rows = (await prisma.$queryRaw`
    SELECT
      lt.id,
      lt.student_id AS "studentId",
      lt.teacher_id AS "teacherId",
      lt.subject,
      lt.lesson,
      lt.topics,
      lt.question,
      lt.response_mode AS "responseMode",
      lt.created_at AS "createdAt",
      u.name AS "studentName"
    FROM learn_turns lt
    INNER JOIN users u ON u.id = lt.student_id
    WHERE lt.teacher_id = ${Number(teacherId)}
    ORDER BY lt.created_at DESC
    LIMIT 400
  `).map((r) => ({
    ...r,
    id: Number(r.id),
    studentId: Number(r.studentId ?? r.studentid),
    teacherId: Number(r.teacherId ?? r.teacherid),
    createdAt: asDate(r.createdAt ?? r.createdat ?? r.created_at),
    studentName: r.studentName ?? r.studentname,
    responseMode: r.responseMode ?? r.responsemode,
  }))
  const profile = await prisma.teacherProfile.findUnique({
    where: { userId: Number(teacherId) },
    select: { subjects: true },
  })
  const taught = teacherSubjectList({ subjects: parseJsonArray(profile?.subjects) })
  const todayStart = startOfUtcDay()
  const bySubject = new Map()
  for (const name of taught) bySubject.set(name, [])
  for (const row of rows) {
    const canonical = matchTeacherSubject(row.subject, taught)
    if (!canonical) continue
    if (!bySubject.has(canonical)) bySubject.set(canonical, [])
    bySubject.get(canonical).push(row)
  }

  async function insightsFor(subject, list) {
    const todayRows = list.filter((r) => r.createdAt && r.createdAt >= todayStart)
    if (!list.length) {
      return {
        subject,
        question_count: 0,
        student_count: 0,
        today_question_count: 0,
        self_learned_topics_today: [],
        frequent_lessons: [],
        insights: [`No Learn questions in ${subject} yet. When students study this with you, insights appear here.`],
        recent_questions: [],
      }
    }
    let insights = heuristicInsights(subject, list, todayRows)
    const cacheKey = `${teacherId}:${subject}:${list[0]?.id}:${list.length}`
    const cached = insightCache.get(cacheKey)
    if (cached) {
      insights = cached
    } else {
      try {
        const generated = await llmInsights(subject, list)
        if (generated.length) insights = generated
      } catch {
        /* keep heuristic */
      }
      insightCache.set(cacheKey, insights)
    }
    return {
      subject,
      question_count: list.length,
      student_count: new Set(list.map((r) => r.studentId)).size,
      today_question_count: todayRows.length,
      self_learned_topics_today: topicSet(todayRows),
      frequent_lessons: lessonCounts(list).slice(0, 6),
      insights,
      recent_questions: list.slice(0, 12).map((r) => ({
        id: r.id,
        question: r.question,
        lesson: r.lesson,
        student_name: r.studentName || 'Student',
        response_mode: r.responseMode,
        created_at: toIso(r.createdAt),
      })),
    }
  }

  insightCacheTeacherId = Number(teacherId)
  const subjects = await Promise.all(
    [...bySubject.entries()].map(([subject, list]) => insightsFor(subject, list)),
  )

  subjects.sort((a, b) => b.question_count - a.question_count || a.subject.localeCompare(b.subject))
  const matchedRows = [...bySubject.values()].flat()
  const todayTopics = [...new Set(subjects.flatMap((s) => s.self_learned_topics_today))].slice(0, 16)
  return {
    teacher_subjects: taught,
    today_question_count: matchedRows.filter((r) => r.createdAt && r.createdAt >= todayStart).length,
    today_topics: todayTopics,
    subjects,
  }
}
