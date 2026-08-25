'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchTeacherInsights } from '../services/api.js'
import { FlapPanel, FlapPanelHead, FlapRow, FlapTab } from './ui/Board.jsx'

function formatWhen(iso) {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  try {
    return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export default function TeacherInsights() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [subject, setSubject] = useState('')

  useEffect(() => {
    let mounted = true
    setLoading(true)
    fetchTeacherInsights().then(({ data: next, error: err }) => {
      if (!mounted) return
      if (err) {
        setError(err.message || 'Could not load insights.')
        setData(null)
      } else {
        setError('')
        setData(next)
        const first = next?.subjects?.[0]?.subject
        setSubject((prev) => prev || first || '')
      }
      setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  const subjects = data?.subjects || []
  const selected = useMemo(
    () => subjects.find((s) => s.subject === subject) || subjects[0] || null,
    [subject, subjects],
  )

  if (loading) {
    return (
      <FlapPanel className="p-8">
        <p className="font-[family-name:var(--font-flap)] text-sm tracking-[0.1em] uppercase text-[var(--flap-mute)] m-0">
          Gathering what students asked in Learn mode…
        </p>
      </FlapPanel>
    )
  }

  if (error) {
    return (
      <div className="px-3 py-2 border border-[var(--flap-cancel)]/50 text-[var(--flap-cancel)] text-sm">
        {error}
      </div>
    )
  }

  if (!subjects.length) {
    return (
      <FlapPanel className="p-8 text-center">
        <p className="font-[family-name:var(--font-flap)] text-lg font-semibold tracking-[0.06em] uppercase text-[var(--flap-ink)] m-0">
          {data && Array.isArray(data.teacher_subjects) && data.teacher_subjects.length === 0
            ? 'No subjects on your profile'
            : 'No Learn conversations yet'}
        </p>
        <p className="text-sm text-[var(--flap-mute)] mt-2 max-w-md mx-auto font-[family-name:var(--font-body)]">
          {data && Array.isArray(data.teacher_subjects) && data.teacher_subjects.length === 0
            ? 'Add the subjects you teach in onboarding. Insights stay private to those subjects and to you.'
            : 'When students pick you and ask a question in one of your subjects, it shows up here—only for you.'}
        </p>
      </FlapPanel>
    )
  }

  return (
    <div className="space-y-4 min-h-0">
      <header>
        <h1 className="font-[family-name:var(--font-flap)] text-xl font-bold tracking-[0.06em] uppercase text-[var(--flap-ink)] m-0">
          Conversation insights
        </h1>
        <p className="text-sm text-[var(--flap-mute)] mt-1 font-[family-name:var(--font-body)]">
          What students asked you in your subjects. Other teachers cannot see this.
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border border-[var(--board-rule)] bg-[var(--board-steel-deep)] p-1">
        {subjects.map((s) => (
          <FlapTab key={s.subject} active={selected?.subject === s.subject} onClick={() => setSubject(s.subject)}>
            {s.subject}
            <span className="ml-1.5 text-[var(--flap-amber)]">{s.question_count}</span>
          </FlapTab>
        ))}
      </div>

      {selected ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 min-h-0">
          <FlapPanel className="xl:col-span-4 flex flex-col min-h-0">
            <FlapPanelHead title={`Today in ${selected.subject}`} meta="Learn mode" />
            <div className="p-4 border-b border-[var(--board-rule)]">
              <p className="font-[family-name:var(--font-flap)] text-3xl font-bold tracking-[0.04em] tabular-nums text-[var(--flap-amber)] m-0">
                {selected.today_question_count}
              </p>
              <p className="text-sm text-[var(--flap-mute)] font-[family-name:var(--font-body)] m-0 mt-1">
                question{selected.today_question_count === 1 ? '' : 's'} in Learn mode
              </p>
            </div>
            <div className="p-4 border-b border-[var(--board-rule)]">
              <p className="font-[family-name:var(--font-flap)] text-[11px] font-semibold tracking-[0.16em] uppercase text-[var(--flap-mute)] m-0 mb-2">
                Self-learned topics today
              </p>
              {selected.self_learned_topics_today.length === 0 ? (
                <p className="text-sm text-[var(--flap-mute)] font-[family-name:var(--font-body)] m-0">
                  Nothing recorded yet today.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selected.self_learned_topics_today.map((topic) => (
                    <span
                      key={topic}
                      className="px-2 py-1 border border-[var(--board-rule)] bg-[var(--flap-face)] font-[family-name:var(--font-flap)] text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--flap-amber)]"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-3 py-2 border-b border-[var(--board-rule)] bg-[var(--board-steel-deep)]">
                <p className="font-[family-name:var(--font-flap)] text-[11px] font-semibold tracking-[0.16em] uppercase text-[var(--flap-ink)] m-0">
                  Frequent lessons
                </p>
              </div>
              <ul className="m-0 p-0 list-none flex-1 min-h-0 overflow-y-auto">
                {selected.frequent_lessons.map((item) => (
                  <li key={item.lesson}>
                    <FlapRow
                      cols={[
                        { label: item.lesson, width: '1fr' },
                        {
                          label: String(item.count),
                          width: '0.4fr',
                          mute: true,
                          className: 'text-right tabular-nums',
                        },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </FlapPanel>

          <div className="xl:col-span-8 space-y-4 min-h-0 flex flex-col">
            <FlapPanel>
              <FlapPanelHead title="Insights from questions" />
              <ul className="m-0 p-0 list-none">
                {selected.insights.map((line) => (
                  <li
                    key={line}
                    className="border-b border-[var(--board-rule)] last:border-b-0 px-3 py-3 text-sm text-[var(--flap-ink)] leading-relaxed font-[family-name:var(--font-body)]"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </FlapPanel>

            <FlapPanel scroll className="flex-1 min-h-0 flex flex-col">
              <FlapPanelHead title="Recent questions" />
              <ul className="m-0 p-0 list-none flex-1 min-h-0 overflow-y-auto">
                {selected.recent_questions.map((q) => (
                  <li key={q.id} className="border-b border-[var(--board-rule)] last:border-b-0 px-3 py-3">
                    <p className="text-sm text-[var(--flap-ink)] leading-relaxed font-[family-name:var(--font-body)] m-0">
                      {q.question}
                    </p>
                    <p className="font-[family-name:var(--font-flap)] text-[10px] tracking-[0.12em] uppercase text-[var(--flap-mute)] mt-1 m-0">
                      {q.student_name}
                      {q.lesson ? ` · ${q.lesson}` : ''}
                      {q.created_at ? ` · ${formatWhen(q.created_at)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </FlapPanel>
          </div>
        </div>
      ) : null}
    </div>
  )
}
