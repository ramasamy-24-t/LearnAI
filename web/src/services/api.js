import axios from 'axios'

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function extractErrors(error) {
  const status = error.response?.status
  const data = error.response?.data

  if (data?.errors && typeof data.errors === 'object') {
    const fieldErrors = Object.fromEntries(
      Object.entries(data.errors).map(([field, messages]) => [
        field,
        Array.isArray(messages) ? messages[0] : String(messages),
      ]),
    )
    const firstFieldMessage = Object.values(fieldErrors)[0]
    const message =
      (typeof data.message === 'string' && data.message) ||
      firstFieldMessage ||
      error.message ||
      'Something went wrong. Please try again.'
    return { fieldErrors, message, status, code: data?.code }
  }

  const message =
    data?.message ||
    data?.error?.message ||
    error.message ||
    'Something went wrong. Please try again.'

  return { message, status, code: data?.code, role: data?.role }
}

export async function registerTeacher(payload) {
  try {
    const response = await api.post('/teacher/register', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function registerStudent(payload) {
  try {
    const response = await api.post('/student/register', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function loginRequest(payload) {
  try {
    const response = await api.post('/login', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function demoLoginRequest(role) {
  try {
    const response = await api.post('/login/demo', { role })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function verifyOtp(payload) {
  try {
    const response = await api.post('/otp/verify', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function resendOtp(payload) {
  try {
    const response = await api.post('/otp/resend', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function submitTeacherOnboarding(payload) {
  try {
    const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData
    const response = await api.post('/teacher/onboarding', payload, isFormData
      ? {
          timeout: 300000,
          transformRequest: [(data, headers) => {
            if (data instanceof FormData) delete headers['Content-Type']
            return data
          }],
        }
      : {})
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

/**
 * Azure TTS for a teacher (returns MP3 blob). Voice is mapped by teacher gender.
 */
export async function fetchTeacherTtsAudio({ teacherId, text, rate }) {
  try {
    const response = await api.post(
      '/tts/speak',
      { teacher_id: teacherId, text, rate },
      {
        responseType: 'blob',
        timeout: 180000,
      },
    )
    const ct = response.headers['content-type'] || ''
    if (ct.includes('application/json')) {
      const raw = await response.data.text()
      let j = {}
      try {
        j = JSON.parse(raw)
      } catch {
        /* ignore */
      }
      return { blob: null, error: { message: j.message || 'Text-to-speech failed.' } }
    }
    return { blob: response.data, error: null }
  } catch (error) {
    let message = error.message || 'Text-to-speech failed.'
    const status = error.response?.status
    if (error.response?.data instanceof Blob) {
      try {
        const raw = await error.response.data.text()
        const j = JSON.parse(raw)
        if (j.message) message = j.message
      } catch {
        /* keep */
      }
    } else if (error.response?.data?.message) {
      message = error.response.data.message
    }
    return { blob: null, error: { message, status } }
  }
}

export async function searchSubjects(query) {
  try {
    const response = await api.get('/subjects', {
      params: { query },
    })
    return response.data.subjects ?? []
  } catch {
    return []
  }
}

export async function ensureSubject({ label }) {
  try {
    const response = await api.post('/subjects', { label })
    return response.data.subject
  } catch {
    return null
  }
}

export async function searchInstitutions(query) {
  try {
    const response = await api.get('/institutions', { params: { query } })
    return response.data.institutions ?? []
  } catch {
    return []
  }
}

export async function ensureInstitution({ label }) {
  try {
    const response = await api.post('/institutions', { label })
    return response.data.institution
  } catch {
    return null
  }
}

export async function fetchBoards() {
  try {
    const response = await api.get('/boards')
    return response.data.boards ?? []
  } catch {
    return []
  }
}

export async function fetchStudentDashboard() {
  try {
    const response = await api.get('/student/dashboard')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

/** End-of-session teacher feedback (saved when student submits review at logout). */
export async function submitSessionFeedback({ teacherId, rating, feedback }) {
  try {
    const response = await api.post('/student/session-feedback', {
      teacher_id: teacherId,
      rating,
      feedback: feedback ?? null,
    })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchTeachers() {
  try {
    const response = await api.get('/teachers')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchTeacherProfile() {
  try {
    const response = await api.get('/teacher/profile')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchTeacherInsights() {
  try {
    const response = await api.get('/teacher/insights')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function updateTeacherProfile(payload) {
  try {
    const response = await api.post('/teacher/profile', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function uploadTeacherAvatar(file) {
  try {
    const form = new FormData()
    form.append('avatar', file)
    // Do not set Content-Type - the browser must set multipart/form-data with the boundary
    const response = await api.post('/teacher/avatar', form, {
      transformRequest: [(data, headers) => {
        if (data instanceof FormData) delete headers['Content-Type']
        return data
      }],
    })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function patchTeacherAccountProfile(payload) {
  try {
    const response = await api.patch('/teacher/account/profile', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function postTeacherAccountPassword(payload) {
  try {
    const response = await api.post('/teacher/account/password', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function postTeacherEmailChangeStart(payload) {
  try {
    const response = await api.post('/teacher/account/email/start', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function postTeacherEmailVerifyOld(payload) {
  try {
    const response = await api.post('/teacher/account/email/verify-old', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function postTeacherEmailVerifyNew(payload) {
  try {
    const response = await api.post('/teacher/account/email/verify-new', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function postTeacherLogoutAllSessions() {
  try {
    const response = await api.post('/teacher/account/logout-all-sessions')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function sendChatMessage({ systemPrompt, messages, learn, temperature }) {
  try {
    const payload = {
      system_prompt: systemPrompt,
      messages,
    }
    if (learn) payload.learn = learn
    if (typeof temperature === 'number') payload.temperature = temperature
    const response = await api.post('/chat', payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

/** D-ID polls server-side for a while; avoid axios timing out early. */
const VIDEO_REQUEST_MS = 600_000 // 10 minutes

export async function generateDidVideo({ avatarUrl, text, voiceId }) {
  try {
    const payload = { text }
    if (avatarUrl) payload.avatar_url = avatarUrl
    if (voiceId) payload.voice_id = voiceId
    const response = await api.post('/chat/video', payload, {
      timeout: VIDEO_REQUEST_MS,
    })
    return { data: response.data, error: null, httpStatus: response.status }
  } catch (error) {
    return { data: null, error: extractErrors(error), httpStatus: error.response?.status }
  }
}

export async function transcribeSpeech({ audioBlob, language = 'en' }) {
  try {
    const form = new FormData()
    form.append('audio', audioBlob, `speech-${Date.now()}.webm`)
    form.append('language', language)

    const response = await api.post('/speech-to-text', form, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })

    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchTeacherCurriculum() {
  try {
    const response = await api.get('/teacher/curriculum')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchTeacherQuizzes() {
  try {
    const response = await api.get('/teacher/quizzes')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function generateTeacherQuiz(payload) {
  try {
    const response = await api.post('/teacher/quizzes/generate', payload, { timeout: 180000 })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchTeacherQuiz(id) {
  try {
    const response = await api.get(`/teacher/quizzes/${id}`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function patchTeacherQuiz(id, payload) {
  try {
    const response = await api.patch(`/teacher/quizzes/${id}`, payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function deleteTeacherQuiz(id) {
  try {
    const response = await api.delete(`/teacher/quizzes/${id}`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function publishTeacherQuiz(id) {
  try {
    const response = await api.post(`/teacher/quizzes/${id}/publish`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function patchQuizQuestion(quizId, questionId, payload) {
  try {
    const response = await api.patch(`/teacher/quizzes/${quizId}/questions/${questionId}`, payload)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function deleteQuizQuestion(quizId, questionId) {
  try {
    const response = await api.delete(`/teacher/quizzes/${quizId}/questions/${questionId}`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function regenerateQuizQuestion(quizId, questionId) {
  try {
    const response = await api.post(`/teacher/quizzes/${quizId}/questions/${questionId}/regenerate`, {}, { timeout: 120000 })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchQuizAnalytics(quizId) {
  try {
    const response = await api.get(`/teacher/quizzes/${quizId}/analytics`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function generateQuizInsights(quizId) {
  try {
    const response = await api.post(`/teacher/quizzes/${quizId}/insights`, {}, { timeout: 120000 })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchStudentQuizInsights(studentId) {
  try {
    const response = await api.get(`/teacher/students/${studentId}/quiz-insights`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchStudentQuizzes() {
  try {
    const response = await api.get('/student/quizzes')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchLearningRecs() {
  try {
    const response = await api.get('/student/learning-recs')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function dismissLearningRec(recId) {
  try {
    const response = await api.patch(`/student/learning-recs/${recId}`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function dismissAllLearningRecs() {
  try {
    const response = await api.patch('/student/learning-recs')
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function startStudentQuiz(quizId) {
  try {
    const response = await api.post(`/student/quizzes/${quizId}/start`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function fetchQuizAttempt(attemptId) {
  try {
    const response = await api.get(`/student/quiz-attempts/${attemptId}`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function submitQuizAnswer(attemptId, payload) {
  try {
    const response = await api.post(`/student/quiz-attempts/${attemptId}/submit-answer`, payload, { timeout: 120000 })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function sendQuizTutorMessage(attemptId, payload) {
  try {
    const response = await api.post(`/student/quiz-attempts/${attemptId}/tutor`, payload, { timeout: 120000 })
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function completeQuizAttempt(attemptId) {
  try {
    const response = await api.post(`/student/quiz-attempts/${attemptId}/complete`)
    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

export async function sendVoiceChatMessage({ systemPrompt, messages, audioBlob, language = 'en', learn }) {
  try {
    const form = new FormData()
    form.append('audio', audioBlob, `speech-${Date.now()}.webm`)
    form.append('language', language)
    form.append('system_prompt', systemPrompt)
    form.append('messages', JSON.stringify(messages))
    if (learn) form.append('learn', JSON.stringify(learn))

    const response = await api.post('/chat/voice', form, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })

    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

/** Gemini vision: homework photo hints (multipart). */
const HOMEWORK_HINT_TIMEOUT_MS = 120_000

export async function sendHomeworkHint({
  imageFile,
  note,
  text,
  systemPrompt,
  messages = [],
  learn,
}) {
  try {
    const form = new FormData()
    if (imageFile) {
      const name = imageFile.name || `homework-${Date.now()}.jpg`
      form.append('image', imageFile, name)
    }
    if (note) form.append('note', note)
    if (text) form.append('text', text)
    form.append('system_prompt', systemPrompt)
    form.append('messages', JSON.stringify(messages || []))
    if (learn) form.append('learn', JSON.stringify(learn))

    const response = await api.post('/homework-hint', form, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: HOMEWORK_HINT_TIMEOUT_MS,
    })

    return { data: response.data, error: null }
  } catch (error) {
    return { data: null, error: extractErrors(error) }
  }
}

