import bcrypt from 'bcryptjs'
import { prisma } from './prisma.js'
import { json, parseJsonArray, readJson, slugKey, titleCase } from './http.js'
import { cacheGet, cacheSet, jsonCached } from './cache.js'
import {
  isDebug,
  publicUser,
  requireUser,
  signToken,
  sixDigitOtp,
} from './auth.js'
import { sendOtpEmail } from './mail.js'
import { chatCompletion, transcribeAudio } from './openai.js'
import { homeworkHintCompletion } from './gemini.js'
import { createVoiceFromSample } from './elevenlabs.js'
import { synthesizeAzureTtsMp3 } from './azureTts.js'
import { generateDidTalk } from './did.js'
import { uploadTeacherAvatar } from './cloudinary.js'
import { detectTeachingStyle } from './styleDetect.js'
import { syncTeacherRating } from './ratings.js'
import { recordLearnTurn, buildTeacherInsights } from './learnTurns.js'
import { dispatchQuizApi } from './quizApi.js'

function minutesFromNow(mins) {
  return new Date(Date.now() + mins * 60_000)
}

async function fileFromForm(entry, fallbackName) {
  if (!entry || typeof entry === 'string') return null
  const buf = Buffer.from(await entry.arrayBuffer())
  const name = entry.name || fallbackName
  const type = entry.type || 'application/octet-stream'
  return new File([buf], name, { type })
}

export async function handleApi(request, slugParts) {
  const slug = slugParts.join('/')
  const method = request.method.toUpperCase()

  try {
    if (slug === 'boards' && method === 'GET') return await boards()
    if (slug === 'subjects' && method === 'GET') return await subjectsGet(request)
    if (slug === 'subjects' && method === 'POST') return await subjectsPost(request)
    if (slug === 'institutions' && method === 'GET') return await institutionsGet(request)
    if (slug === 'institutions' && method === 'POST') return await institutionsPost(request)
    if (slug === 'teacher/register' && method === 'POST') return await registerTeacher(request)
    if (slug === 'student/register' && method === 'POST') return await registerStudent(request)
    if (slug === 'login' && method === 'POST') return await login(request)
    if (slug === 'login/demo' && method === 'POST') return await demoLogin(request)
    if (slug === 'otp/verify' && method === 'POST') return await verifyOtp(request)
    if (slug === 'otp/resend' && method === 'POST') return await resendOtp(request)
    if (slug === 'student/dashboard' && method === 'GET') return await studentDashboard(request)
    if (slug === 'student/session-feedback' && method === 'POST') return await sessionFeedback(request)
    if (slug === 'teachers' && method === 'GET') return await teachers(request)
    if (slug === 'tts/speak' && method === 'POST') return await ttsSpeak(request)
    if (slug === 'teacher/profile' && method === 'GET') return await teacherProfileGet(request)
    if (slug === 'teacher/profile' && method === 'POST') return await teacherProfilePost(request)
    if (slug === 'teacher/avatar' && method === 'POST') return await teacherAvatar(request)
    if (slug === 'teacher/onboarding' && method === 'POST') return await teacherOnboarding(request)
    if (slug === 'teacher/onboarding-status' && method === 'GET') return await onboardingStatus(request)
    if (slug === 'teacher/account/profile' && method === 'PATCH') return await accountProfile(request)
    if (slug === 'teacher/account/password' && method === 'POST') return await accountPassword(request)
    if (slug === 'teacher/account/email/start' && method === 'POST') return await emailStart(request)
    if (slug === 'teacher/account/email/verify-old' && method === 'POST') return await emailVerifyOld(request)
    if (slug === 'teacher/account/email/verify-new' && method === 'POST') return await emailVerifyNew(request)
    if (slug === 'teacher/account/logout-all-sessions' && method === 'POST') return await logoutAll(request)
    if (slug === 'teacher/insights' && method === 'GET') return await teacherInsights(request)
    if (slug === 'speech-to-text' && method === 'POST') return await speechToText(request)
    if (slug === 'chat' && method === 'POST') return await chat(request)
    if (slug === 'chat/voice' && method === 'POST') return await voiceChat(request)
    if (slug === 'chat/video' && method === 'POST') return await chatVideo(request)
    if (slug === 'homework-hint' && method === 'POST') return await homeworkHint(request)
    const quizResponse = await dispatchQuizApi(request, slugParts, method)
    if (quizResponse) return quizResponse
    return json({ message: 'Not found.' }, 404)
  } catch (error) {
    const status = Number(error.status)
    const safeStatus = status >= 400 && status < 600 ? status : 500
    if (safeStatus >= 500) console.error(error)
    return json({ message: error.message || 'Server error.' }, safeStatus)
  }
}

async function boards() {
  const cacheKey = 'boards:with-grades'
  const cached = cacheGet(cacheKey)
  if (cached) return jsonCached({ boards: cached }, { maxAge: 120 })
  const rows = await prisma.board.findMany({
    where: { grades: { some: {} } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true },
  })
  cacheSet(cacheKey, rows, 120_000)
  return jsonCached({ boards: rows }, { maxAge: 120 })
}

async function subjectsGet(request) {
  const query = new URL(request.url).searchParams.get('query')?.trim() || ''
  if (!query) return json({ subjects: [] })
  const q = query.toLowerCase()
  const subjects = await prisma.subject.findMany({
    where: {
      OR: [
        { key: { startsWith: q } },
        { label: { contains: query } },
      ],
    },
    take: 8,
    select: { id: true, key: true, label: true },
  })
  return json({ subjects })
}

async function subjectsPost(request) {
  const body = await readJson(request)
  const label = titleCase(body.label)
  if (!label) return json({ message: 'label is required.' }, 422)
  const key = slugKey(label)
  const subject = await prisma.subject.upsert({
    where: { key },
    update: {},
    create: { key, label },
    select: { id: true, key: true, label: true },
  })
  return json({ subject })
}

async function institutionsGet(request) {
  const query = new URL(request.url).searchParams.get('query')?.trim() || ''
  if (!query) return json({ institutions: [] })
  const institutions = await prisma.institution.findMany({
    where: {
      OR: [{ key: { startsWith: query.toLowerCase() } }, { label: { contains: query } }],
    },
    take: 8,
    select: { id: true, key: true, label: true },
  })
  return json({ institutions })
}

async function institutionsPost(request) {
  const body = await readJson(request)
  const label = titleCase(body.label)
  if (!label) return json({ message: 'label is required.' }, 422)
  const key = slugKey(label)
  const institution = await prisma.institution.upsert({
    where: { key },
    update: {},
    create: { key, label },
    select: { id: true, key: true, label: true },
  })
  return json({ institution })
}

async function registerTeacher(request) {
  const body = await readJson(request)
  const { name, email, password, password_confirmation: confirm } = body
  if (!name || !email || !password) return json({ message: 'Missing required fields.' }, 422)
  if (password.length < 6) return json({ message: 'Password must be at least 6 characters.' }, 422)
  if (confirm != null && password !== confirm) return json({ message: 'Password confirmation does not match.' }, 422)
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return json({ message: 'The email has already been taken.', errors: { email: ['The email has already been taken.'] } }, 422)

  const otp = sixDigitOtp()
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash(password, 12),
      role: 'teacher',
      otpCode: otp,
      otpVerified: false,
      otpExpiresAt: minutesFromNow(10),
    },
  })
  const payload = {
    message: 'Teacher registered successfully.',
    user: publicUser(user, { otp_verified: false, onboarding_completed: false }),
    otp_code: otp,
  }
  return json(payload)
}

async function registerStudent(request) {
  const body = await readJson(request)
  const { name, email, password, password_confirmation: confirm, board_id: boardId, current_grade: currentGrade, institution } = body
  if (!name || !email || !password || !boardId || !currentGrade || !institution) {
    return json({ message: 'Missing required fields.' }, 422)
  }
  if (password.length < 6) return json({ message: 'Password must be at least 6 characters.' }, 422)
  if (confirm != null && password !== confirm) return json({ message: 'Password confirmation does not match.' }, 422)
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return json({ message: 'The email has already been taken.', errors: { email: ['The email has already been taken.'] } }, 422)

  const gradeRow = await prisma.boardGrade.findFirst({
    where: { boardId: Number(boardId), canonicalLevel: Number(currentGrade) },
  })
  if (!gradeRow) {
    return json({ message: 'Selected board does not have an equivalent grade mapping for this grade.' }, 422)
  }

  const cleanInstitution = titleCase(institution)
  const inst = await prisma.institution.upsert({
    where: { key: slugKey(institution) },
    update: {},
    create: { key: slugKey(institution), label: cleanInstitution },
  })

  const otp = sixDigitOtp()
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash(password, 12),
      role: 'student',
      otpCode: otp,
      otpVerified: false,
      otpExpiresAt: minutesFromNow(10),
      boardId: Number(boardId),
      gradeId: gradeRow.id,
      institutionId: inst.id,
      grade: String(currentGrade),
    },
  })
  await prisma.studentProfile.create({
    data: {
      userId: user.id,
      boardId: Number(boardId),
      gradeId: gradeRow.id,
      grade: String(currentGrade),
      institutionId: inst.id,
    },
  })
  const payload = {
    message: 'Student registered successfully.',
    user: publicUser(user, {
      board_id: Number(boardId),
      grade: String(currentGrade),
      grade_id: gradeRow.id,
      institution_id: inst.id,
      otp_verified: false,
      onboarding_completed: false,
    }),
    otp_code: otp,
  }
  return json(payload)
}

const DEMO_ACCOUNTS = {
  student: { email: 'rsamy2426@gmail.com' },
  teacher: { email: 'ram.holoroid@gmail.com' },
}

async function loginPayload(user) {
  let onboardingCompleted = true
  if (user.role === 'teacher') {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: user.id } })
    onboardingCompleted = Boolean(profile?.onboardingCompleted)
  }
  return {
    message: 'Logged in successfully.',
    token: signToken(user.id, user.tokenVersion ?? 0),
    user: publicUser(user, {
      onboarding_completed: onboardingCompleted,
      password_changed_at: user.passwordChangedAt,
      email_changed_at: user.emailChangedAt,
    }),
  }
}

async function login(request) {
  const body = await readJson(request)
  const { email, password, role } = body
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return json({ message: 'Invalid email or password.' }, 401)
  }
  if (role && user.role !== role) {
    const expected = user.role[0].toUpperCase() + user.role.slice(1)
    return json({
      message: `This account is registered as a ${expected}. Please select '${expected}' and try again.`,
      role: user.role,
    }, 403)
  }
  return json(await loginPayload(user))
}

async function demoLogin(request) {
  const body = await readJson(request)
  const role = String(body.role || '').trim().toLowerCase()
  const target = DEMO_ACCOUNTS[role]
  if (!target) return json({ message: 'Unknown demo role.' }, 422)
  const user = await prisma.user.findUnique({ where: { email: target.email } })
  if (!user || user.role !== role) {
    return json({ message: 'Demo account is not set up yet.' }, 404)
  }
  return json(await loginPayload(user))
}

async function verifyOtp(request) {
  const body = await readJson(request)
  const user = await prisma.user.findUnique({ where: { id: Number(body.user_id) } })
  if (!user) return json({ message: 'User not found.' }, 422)
  if (user.otpVerified) return json({ message: 'OTP already verified.', otp_verified: true })
  if (user.otpCode !== String(body.otp_code)) return json({ message: 'Invalid OTP. Please try again.' }, 422)
  if (user.otpExpiresAt && user.otpExpiresAt < new Date()) {
    return json({ message: 'OTP has expired. Please request a new one.' }, 422)
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { otpVerified: true, otpCode: null },
  })
  let onboardingCompleted = true
  if (updated.role === 'teacher') {
    const profile = await prisma.teacherProfile.findUnique({ where: { userId: updated.id } })
    onboardingCompleted = Boolean(profile?.onboardingCompleted)
  }
  return json({
    message: 'OTP verified successfully.',
    otp_verified: true,
    token: signToken(updated.id, updated.tokenVersion ?? 0),
    user: publicUser(updated, { onboarding_completed: onboardingCompleted }),
  })
}

async function resendOtp(request) {
  const body = await readJson(request)
  const user = await prisma.user.findUnique({ where: { id: Number(body.user_id) } })
  if (!user) return json({ message: 'User not found.' }, 422)
  if (user.otpVerified) return json({ message: 'OTP already verified.', otp_verified: true }, 422)
  const lastSentAt = user.otpExpiresAt ? new Date(user.otpExpiresAt.getTime() - 10 * 60_000) : null
  if (lastSentAt && Date.now() - lastSentAt.getTime() < 180_000) {
    const retryAfter = Math.max(1, Math.ceil((180_000 - (Date.now() - lastSentAt.getTime())) / 1000))
    return json({ message: 'Please wait before requesting another OTP.', retry_after: retryAfter }, 429)
  }
  const otp = sixDigitOtp()
  await prisma.user.update({
    where: { id: user.id },
    data: { otpCode: otp, otpExpiresAt: minutesFromNow(10) },
  })
  return json({ message: 'OTP updated.', retry_after: 180, otp_code: otp })
}

async function studentDashboard(request) {
  const auth = await requireUser(request, 'student')
  if (auth.error) return auth.error
  const user = auth.user

  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    include: {
      board: true,
      boardGrade: true,
      institution: { select: { id: true, key: true, label: true } },
    },
  })

  const boardId = profile?.boardId || user.boardId
  const gradeId = profile?.gradeId || user.gradeId
  let board = profile?.board || null
  let grade = profile?.boardGrade || null

  if (!board && boardId) {
    board = await prisma.board.findUnique({ where: { id: boardId } })
  }
  if (!grade && gradeId) {
    grade = await prisma.boardGrade.findUnique({ where: { id: gradeId } })
  }
  if (!grade && board && (profile?.grade || user.grade)) {
    grade = await prisma.boardGrade.findFirst({
      where: { boardId: board.id, label: profile?.grade || user.grade },
    })
  }
  if (!board) {
    return json({
      message: 'Student profile missing board. Please select your board during sign up.',
      user: publicUser(user),
      subjects: [],
    }, 422)
  }
  if (!grade && !(profile?.grade || user.grade)) {
    return json({
      message: 'Student profile missing grade. Please select your grade during sign up.',
      user: { ...publicUser(user), board: { id: board.id, name: board.name, slug: board.slug } },
      subjects: [],
    }, 422)
  }

  const curriculumKey = `curriculum:${board.id}:${grade?.id || profile?.grade || user.grade || 'none'}`
  let curricula = cacheGet(curriculumKey)
  if (!curricula) {
    curricula = await prisma.curriculum.findMany({
      where: {
        boardId: board.id,
        ...(grade ? { gradeId: grade.id } : { grade: profile?.grade || user.grade }),
      },
      include: {
        subject: { select: { id: true, key: true, label: true } },
        units: {
          orderBy: { sortOrder: 'asc' },
          include: { topics: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    })
    cacheSet(curriculumKey, curricula, 180_000)
  }

  const institution = profile?.institution || null
  const institutionId = profile?.institutionId || user.institutionId

  return json({
    user: {
      ...publicUser(user),
      board_id: board.id,
      grade: profile?.grade || user.grade,
      grade_id: grade?.id,
      institution_id: institutionId,
      profile: profile
        ? {
            id: profile.id,
            board_id: profile.boardId,
            grade_id: profile.gradeId,
            grade: profile.grade,
            institution_id: profile.institutionId,
          }
        : null,
      board: { id: board.id, name: board.name, slug: board.slug },
      grade: grade ? { id: grade.id, label: grade.label, canonical_level: grade.canonicalLevel } : null,
      institution: institution
        ? { id: institution.id, key: institution.key, label: institution.label }
        : null,
    },
    subjects: curricula
      .filter((c) => c.subject)
      .map((c) => ({
        id: c.subject.id,
        key: c.subject.key,
        label: c.subject.label,
        curriculum_id: c.id,
        units: c.units.map((u) => ({
          id: u.id,
          title: u.title,
          sort_order: u.sortOrder,
          topics: u.topics.map((t) => ({ id: t.id, title: t.title, sort_order: t.sortOrder })),
        })),
      })),
  })
}

async function sessionFeedback(request) {
  const auth = await requireUser(request, 'student')
  if (auth.error) return auth.error
  const body = await readJson(request)
  const teacherId = Number(body.teacher_id)
  const rating = Number(body.rating)
  if (!teacherId || rating < 1 || rating > 5) return json({ message: 'Invalid rating.' }, 422)
  await prisma.teacherRating.create({
    data: {
      studentId: auth.user.id,
      teacherId,
      rating,
      feedback: body.feedback ? String(body.feedback).slice(0, 255) : null,
    },
  })
  await syncTeacherRating(teacherId)
  return json({ message: 'Feedback saved.' })
}

async function teachers(request) {
  const auth = await requireUser(request, 'student')
  if (auth.error) return auth.error
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page') || 1))
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') || 50)))
  const where = { role: 'teacher' }
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        name: true,
        teacherProfile: {
          select: {
            schoolName: true,
            rating: true,
            detectedTeachingStyle: true,
            avatarUrl: true,
            elevenlabsVoiceId: true,
            tunePreferences: true,
            subjects: true,
          },
        },
        _count: { select: { ratingsReceived: true } },
      },
    }),
  ])
  return json({
    teachers: rows.map((t) => {
      const count = t._count.ratingsReceived
      const avg = t.teacherProfile?.rating == null ? null : Number(t.teacherProfile.rating)
      return {
        id: t.id,
        name: t.name,
        school: t.teacherProfile?.schoolName || null,
        rating: avg,
        rating_count: count,
        style: t.teacherProfile?.detectedTeachingStyle || 'General',
        avatar_url: t.teacherProfile?.avatarUrl || null,
        has_cloned_voice: Boolean(t.teacherProfile?.elevenlabsVoiceId),
        tune_preferences: parseJsonArray(t.teacherProfile?.tunePreferences),
        subjects: parseJsonArray(t.teacherProfile?.subjects),
      }
    }),
    meta: {
      current_page: page,
      per_page: perPage,
      total,
      last_page: Math.max(1, Math.ceil(total / perPage)),
    },
  })
}

async function ttsSpeak(request) {
  const auth = await requireUser(request)
  if (auth.error) return auth.error
  if (auth.user.role !== 'student' && auth.user.role !== 'teacher') {
    return json({ message: 'Forbidden.' }, 403)
  }
  const body = await readJson(request)
  const teacherId = Number(body.teacher_id)
  if (auth.user.role === 'teacher' && auth.user.id !== teacherId) {
    return json({ message: 'Forbidden.' }, 403)
  }
  const teacher = await prisma.user.findFirst({
    where: { id: teacherId, role: 'teacher' },
  })
  if (!teacher) return json({ message: 'Teacher not found.' }, 404)
  const peers = await prisma.user.findMany({
    where: { role: 'teacher' },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })
  const mp3 = await synthesizeAzureTtsMp3({
    teacher,
    peers,
    text: sanitizeMathForSpeech(String(body.text || '')),
    rate: body.rate,
  })
  return new Response(mp3, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
  })
}

function serializeTeacherProfile(profile, extras = {}) {
  if (!profile) return null
  return {
    upload_preference: profile.uploadPreference,
    grades: parseJsonArray(profile.grades),
    subjects: parseJsonArray(profile.subjects),
    number_of_syllabi: profile.numberOfSyllabi,
    number_of_materials: profile.numberOfMaterials,
    teaching_explanation: profile.teachingExplanation,
    detected_teaching_style: profile.detectedTeachingStyle,
    school_name: profile.schoolName,
    rating: profile.rating == null ? null : Number(profile.rating),
    avatar_url: profile.avatarUrl,
    onboarding_completed: profile.onboardingCompleted,
    tune_preferences: parseJsonArray(profile.tunePreferences),
    ...extras,
  }
}

async function teacherProfileGet(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const teacherId = auth.user.id
  const [profile, ratingAgg, distinctStudents, commentRows] = await Promise.all([
    prisma.teacherProfile.findUnique({ where: { userId: teacherId } }),
    prisma.teacherRating.aggregate({
      where: { teacherId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.teacherRating.findMany({
      where: { teacherId },
      distinct: ['studentId'],
      select: { studentId: true },
    }),
    prisma.teacherRating.findMany({
      where: { teacherId, rating: { gte: 3 }, feedback: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { feedback: true, rating: true, createdAt: true },
    }),
  ])
  const avg = ratingAgg._avg.rating == null ? null : Math.round(ratingAgg._avg.rating * 100) / 100
  if (profile && (profile.rating == null || Number(profile.rating) !== avg)) {
    await prisma.teacherProfile.updateMany({
      where: { userId: teacherId },
      data: { rating: avg },
    })
  }
  const comments = commentRows
    .filter((r) => r.feedback)
    .map((r) => ({
      feedback: r.feedback,
      rating: r.rating,
      created_at: r.createdAt.toISOString(),
    }))
  return json({
    user: publicUser(auth.user, {
      password_changed_at: auth.user.passwordChangedAt,
      email_changed_at: auth.user.emailChangedAt,
    }),
    profile: serializeTeacherProfile(profile, {
      rating: avg,
      rating_count: ratingAgg._count.rating,
      students_helped_count: distinctStudents.length,
      overview_comments: comments,
    }) || {
      onboarding_completed: false,
      grades: [],
      subjects: [],
      tune_preferences: [],
      rating_count: 0,
      students_helped_count: 0,
      overview_comments: [],
    },
  })
}

async function teacherProfilePost(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const body = await readJson(request)
  const data = {}
  if (body.school_name != null) data.schoolName = body.school_name
  if (body.upload_preference != null) data.uploadPreference = body.upload_preference
  if (body.grades != null) data.grades = body.grades
  if (body.subjects != null) data.subjects = body.subjects
  if (body.number_of_syllabi != null) data.numberOfSyllabi = Number(body.number_of_syllabi)
  if (body.number_of_materials != null) data.numberOfMaterials = Number(body.number_of_materials)
  if (body.tune_preferences != null) data.tunePreferences = body.tune_preferences
  const profile = await prisma.teacherProfile.upsert({
    where: { userId: auth.user.id },
    update: data,
    create: { userId: auth.user.id, ...data },
  })
  return json({
    message: 'Profile updated.',
    profile: serializeTeacherProfile(profile),
  })
}

async function teacherAvatar(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const form = await request.formData()
  const avatar = form.get('avatar')
  if (!avatar || typeof avatar === 'string') return json({ message: 'avatar is required.' }, 422)
  const buf = Buffer.from(await avatar.arrayBuffer())
  const uploaded = await uploadTeacherAvatar(buf, auth.user.id)
  await prisma.teacherProfile.upsert({
    where: { userId: auth.user.id },
    update: { avatarUrl: uploaded.avatarUrl, avatarPublicId: uploaded.publicId },
    create: { userId: auth.user.id, avatarUrl: uploaded.avatarUrl, avatarPublicId: uploaded.publicId },
  })
  return json({ avatar_url: uploaded.avatarUrl, message: 'Avatar updated.' })
}

async function teacherOnboarding(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const form = await request.formData()
  const audioFile = await fileFromForm(form.get('audio'), 'onboarding.webm')
  if (!audioFile) return json({ message: 'audio is required.' }, 422)
  const language = form.get('language') || undefined
  let transcript
  try {
    transcript = await transcribeAudio(audioFile, language)
  } catch (error) {
    return json({ message: `Transcription failed: ${error.message}` }, error.status || 502)
  }
  if ((transcript || '').length < 100) {
    return json({ message: 'Please speak a bit longer (about 35+ seconds) so we can capture your teaching style.' }, 422)
  }

  const voiceName = `${auth.user.name || 'Teacher'} — LearnAI`.slice(0, 100)
  let voiceId
  try {
    const cloneFile = await fileFromForm(form.get('audio'), 'onboarding.webm')
    voiceId = await createVoiceFromSample(cloneFile, voiceName)
  } catch (error) {
    return json({ message: `Voice cloning failed: ${error.message}` }, 502)
  }

  const detected = await detectTeachingStyle(transcript)
  const grades = parseJsonArray(String(form.get('grades') || '[]'))
  const subjects = parseJsonArray(String(form.get('subjects') || '[]'))
  await prisma.teacherProfile.upsert({
    where: { userId: auth.user.id },
    update: {
      uploadPreference: String(form.get('upload_preference') || 'both'),
      grades,
      subjects,
      numberOfSyllabi: form.get('number_of_syllabi') ? Number(form.get('number_of_syllabi')) : null,
      numberOfMaterials: form.get('number_of_materials') ? Number(form.get('number_of_materials')) : null,
      teachingExplanation: transcript,
      elevenlabsVoiceId: voiceId,
      detectedTeachingStyle: detected.style,
      onboardingCompleted: true,
    },
    create: {
      userId: auth.user.id,
      uploadPreference: String(form.get('upload_preference') || 'both'),
      grades,
      subjects,
      numberOfSyllabi: form.get('number_of_syllabi') ? Number(form.get('number_of_syllabi')) : null,
      numberOfMaterials: form.get('number_of_materials') ? Number(form.get('number_of_materials')) : null,
      teachingExplanation: transcript,
      elevenlabsVoiceId: voiceId,
      detectedTeachingStyle: detected.style,
      onboardingCompleted: true,
    },
  })
  return json({
    message: 'Teaching profile created successfully.',
    detected_style: detected.style,
    ai_confidence: detected.ai_confidence ?? 0,
    ai_reason: detected.ai_reason,
    onboarding_completed: true,
    transcript_preview: transcript.slice(0, 200),
  })
}

async function onboardingStatus(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const profile = await prisma.teacherProfile.findUnique({ where: { userId: auth.user.id } })
  return json({ onboarding_completed: Boolean(profile?.onboardingCompleted) })
}

async function accountProfile(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const body = await readJson(request)
  if (!body.name) return json({ message: 'name is required.' }, 422)
  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { name: String(body.name) },
  })
  return json({ message: 'Profile updated.', user: publicUser(user) })
}

async function accountPassword(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const body = await readJson(request)
  if (!body.password || String(body.password).length < 8) {
    return json({ message: 'Password must be at least 8 characters.' }, 422)
  }
  if (body.password_confirmation != null && body.password !== body.password_confirmation) {
    return json({ message: 'Password confirmation does not match.' }, 422)
  }
  await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      password: await bcrypt.hash(body.password, 12),
      passwordChangedAt: new Date(),
    },
  })
  return json({ message: 'Password updated successfully.' })
}

async function emailStart(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const body = await readJson(request)
  const newEmail = String(body.new_email || '').trim()
  if (!newEmail) return json({ message: 'new_email is required.' }, 422)
  if (newEmail === auth.user.email) return json({ message: 'email_same_as_current', code: 'email_same_as_current' }, 422)
  const taken = await prisma.user.findUnique({ where: { email: newEmail } })
  if (taken) return json({ message: 'email_already_exists', code: 'email_already_exists' }, 422)
  const otp = sixDigitOtp()
  await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      pendingEmail: newEmail,
      emailChangeCode: otp,
      emailChangeExpiresAt: minutesFromNow(15),
      emailChangePhase: 'awaiting_old_otp',
    },
  })
  const emailError = await sendOtpEmail(auth.user.email, otp, auth.user.name)
  if (emailError) return json({ message: emailError }, 502)
  const payload = { message: 'OTP sent to your current email.' }
  if (isDebug()) payload.debug_otp = otp
  return json(payload)
}

async function emailVerifyOld(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const body = await readJson(request)
  if (auth.user.emailChangePhase !== 'awaiting_old_otp' || auth.user.emailChangeCode !== String(body.otp)) {
    return json({ message: 'Invalid OTP.' }, 422)
  }
  if (auth.user.emailChangeExpiresAt && auth.user.emailChangeExpiresAt < new Date()) {
    return json({ message: 'OTP expired.' }, 422)
  }
  const otp = sixDigitOtp()
  await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      emailChangeCode: otp,
      emailChangeExpiresAt: minutesFromNow(15),
      emailChangePhase: 'awaiting_new_otp',
    },
  })
  const emailError = await sendOtpEmail(auth.user.pendingEmail, otp, auth.user.name)
  if (emailError) return json({ message: emailError }, 502)
  const payload = { message: 'OTP sent to your new email.' }
  if (isDebug()) payload.debug_otp = otp
  return json(payload)
}

async function emailVerifyNew(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const body = await readJson(request)
  if (auth.user.emailChangePhase !== 'awaiting_new_otp' || auth.user.emailChangeCode !== String(body.otp)) {
    return json({ message: 'Invalid OTP.' }, 422)
  }
  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      email: auth.user.pendingEmail,
      emailChangedAt: new Date(),
      pendingEmail: null,
      emailChangeCode: null,
      emailChangeExpiresAt: null,
      emailChangePhase: null,
    },
  })
  return json({ message: 'Email updated.', user: publicUser(user) })
}

async function logoutAll(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  await prisma.user.update({
    where: { id: auth.user.id },
    data: { rememberToken: sixDigitOtp() + sixDigitOtp() },
  })
  return json({ message: 'All other sessions will be signed out.' })
}

async function speechToText(request) {
  const auth = await requireUser(request)
  if (auth.error) return auth.error
  const form = await request.formData()
  const audio = await fileFromForm(form.get('audio'), 'speech.webm')
  if (!audio) return json({ message: 'audio is required.' }, 422)
  const transcript = await transcribeAudio(audio, form.get('language') || undefined)
  return json({ transcript })
}

async function chat(request) {
  const auth = await requireUser(request)
  if (auth.error) return auth.error
  const body = await readJson(request)
  const chatOpts = {
    systemPrompt: body.system_prompt,
    messages: body.messages || [],
  }
  if (typeof body.temperature === 'number') chatOpts.temperature = body.temperature
  const result = await chatCompletion(chatOpts)
  if (auth.user.role === 'student' && result.answer && body.learn) {
    await recordLearnTurn({
      studentId: auth.user.id,
      teacherId: body.learn.teacher_id,
      subject: body.learn.subject,
      lesson: body.learn.lesson,
      topics: body.learn.topics,
      question: body.learn.question,
      answer: result.answer,
      responseMode: body.learn.response_mode,
    })
  }
  return json({ answer: result.answer, usage: result.usage })
}

async function voiceChat(request) {
  const auth = await requireUser(request)
  if (auth.error) return auth.error
  const form = await request.formData()
  const audio = await fileFromForm(form.get('audio'), 'speech.webm')
  if (!audio) return json({ message: 'audio is required.' }, 422)
  const transcript = await transcribeAudio(audio, form.get('language') || undefined)
  if (!transcript) return json({ message: 'Could not detect speech in audio.' }, 422)
  let messages = []
  try {
    messages = JSON.parse(String(form.get('messages') || '[]'))
  } catch {
    messages = []
  }
  let learn = null
  try {
    learn = JSON.parse(String(form.get('learn') || 'null'))
  } catch {
    learn = null
  }
  const systemPrompt = `${form.get('system_prompt') || ''}\n\nNote: The latest user message came from voice transcription. If phrasing seems ambiguous, infer intent conservatively and ask a clarifying question if needed.`
  const result = await chatCompletion({
    systemPrompt,
    messages: [...messages, { role: 'user', content: transcript }],
  })
  if (auth.user.role === 'student' && result.answer && learn) {
    await recordLearnTurn({
      studentId: auth.user.id,
      teacherId: learn.teacher_id,
      subject: learn.subject,
      lesson: learn.lesson,
      topics: learn.topics,
      question: transcript,
      answer: result.answer,
      responseMode: learn.response_mode,
    })
  }
  return json({ transcript, answer: result.answer, usage: result.usage })
}

const HOMEWORK_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const HOMEWORK_IMAGE_MAX_BYTES = 8 * 1024 * 1024

async function homeworkHint(request) {
  const auth = await requireUser(request)
  if (auth.error) return auth.error
  if (auth.user.role !== 'student') {
    return json({ message: 'Only students can use homework photo hints.' }, 403)
  }

  const form = await request.formData()
  const imageEntry = form.get('image')
  const note = String(form.get('note') || '').trim()
  const systemPrompt = String(form.get('system_prompt') || '').trim()
  if (!systemPrompt) {
    return json({ message: 'system_prompt is required.' }, 422)
  }

  let messages = []
  try {
    messages = JSON.parse(String(form.get('messages') || '[]'))
  } catch {
    messages = []
  }
  let learn = null
  try {
    learn = JSON.parse(String(form.get('learn') || 'null'))
  } catch {
    learn = null
  }

  let imageBase64 = null
  let mimeType = 'image/jpeg'
  if (imageEntry && typeof imageEntry !== 'string') {
    mimeType = imageEntry.type || 'image/jpeg'
    if (!HOMEWORK_IMAGE_TYPES.has(mimeType)) {
      return json({ message: 'Please upload a JPG, PNG, or WEBP image.' }, 422)
    }
    const buf = Buffer.from(await imageEntry.arrayBuffer())
    if (buf.length > HOMEWORK_IMAGE_MAX_BYTES) {
      return json({ message: 'Image is too large. Please upload a file under 8MB.' }, 422)
    }
    if (buf.length === 0) {
      return json({ message: 'Image file is empty.' }, 422)
    }
    imageBase64 = buf.toString('base64')
  }

  if (!imageBase64 && !note && (!Array.isArray(messages) || messages.length === 0)) {
    return json({ message: 'A homework photo or a follow-up message is required.' }, 422)
  }

  const userText =
    note ||
    (imageBase64
      ? ''
      : String(form.get('text') || '').trim() || 'Please continue helping with a hint only.')

  const result = await homeworkHintCompletion({
    systemPrompt,
    text: userText,
    imageBase64,
    mimeType,
    history: Array.isArray(messages) ? messages : [],
  })

  const questionLabel = imageBase64
    ? `[Homework photo]${note ? ` ${note}` : ' Help me with this problem'}`
    : note || userText || '[Homework follow-up]'

  if (result.answer && learn) {
    await recordLearnTurn({
      studentId: auth.user.id,
      teacherId: learn.teacher_id,
      subject: learn.subject,
      lesson: learn.lesson,
      topics: learn.topics,
      question: learn.question || questionLabel,
      answer: result.answer,
      responseMode: learn.response_mode || 'text',
    })
  }

  return json({ answer: result.answer, usage: result.usage })
}

async function teacherInsights(request) {
  const auth = await requireUser(request, 'teacher')
  if (auth.error) return auth.error
  const data = await buildTeacherInsights(auth.user.id)
  return json(data)
}

async function chatVideo(request) {
  const auth = await requireUser(request)
  if (auth.error) return auth.error
  const body = await readJson(request)
  const result = await generateDidTalk({
    avatarUrl: body.avatar_url,
    text: body.text,
    voiceId: body.voice_id,
  })
  if (result.pending) return json(result, 202)
  return json(result)
}
