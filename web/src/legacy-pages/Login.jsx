'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import FormInput from '../components/FormInput.jsx'
import RoleToggle from '../components/RoleToggle.jsx'
import { useAuth } from '../context/useAuth.js'
import { resolveRoute } from '../context/AuthContextInner.jsx'

function Login() {
  const { login, loginDemo, user, token, authReady } = useAuth()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [role, setRole] = useState('teacher')
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [generalError, setGeneralError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!authReady || !mounted || !token || !user) return
    router.replace(resolveRoute(user))
  }, [authReady, mounted, router, token, user])

  const validate = () => {
    const errs = {}
    if (!form.email.trim()) errs.email = 'Email is required.'
    if (!form.password.trim()) errs.password = 'Password is required.'
    return errs
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return }
    setSubmitting(true); setErrors({}); setGeneralError('')
    const { error, ok, redirectTo } = await login({ email: form.email, password: form.password, role })
    if (!ok && error) {
      if (error.fieldErrors) setErrors(error.fieldErrors)
      else if (error.message) setGeneralError(error.message)
      if (error.role) setRole(String(error.role).toLowerCase())
      setSubmitting(false); return
    }
    if (redirectTo) router.replace(redirectTo)
    setSubmitting(false)
  }

  const handleDemoLogin = async (demoRole) => {
    if (submitting) return
    setSubmitting(true)
    setErrors({})
    setGeneralError('')
    setRole(demoRole)
    const { error, ok, redirectTo } = await loginDemo(demoRole)
    if (!ok && error) {
      if (error.message) setGeneralError(error.message)
      setSubmitting(false)
      return
    }
    if (redirectTo) router.replace(redirectTo)
    setSubmitting(false)
  }

  if (!mounted) {
    return <div className="min-h-[100dvh] bg-[var(--board-steel-deep)]" />
  }

  return (
    <div className="min-h-[100dvh] flex items-stretch justify-center bg-[var(--board-steel-deep)]">
      <div className="w-full max-w-[960px] grid grid-cols-1 md:grid-cols-[0.9fr_1.1fr] bg-[var(--board-steel)] border border-[var(--board-rule)] animate-auth-fade md:self-center md:my-8">

        <aside className="hidden md:flex flex-col justify-end p-10 bg-[var(--board-steel-deep)] text-[var(--flap-ink)] border-r border-[var(--board-rule)] relative" aria-hidden="true">
          <div className="relative z-10 max-w-xs">
            <p className="font-[family-name:var(--font-flap)] text-[1.6rem] font-semibold tracking-[0.04em] uppercase mb-2">
              Smarter learning, anytime
            </p>
            <p className="text-sm text-[var(--flap-mute)] leading-relaxed">
              LearnAI helps students grasp concepts faster with guidance that matches how their teachers explain—while
              making that teaching presence available around the clock, not only during the bell.
            </p>
          </div>
        </aside>

        <div className="px-7 py-9 md:px-10 overflow-y-auto">
          <header className="mb-5">
            <p className="font-[family-name:var(--font-flap)] text-[1.6rem] font-semibold tracking-[0.04em] uppercase text-[var(--flap-ink)] mb-0.5">
              Welcome back to LearnAI
            </p>
            <p className="text-sm text-[var(--flap-mute)]">Sign in to learn faster - or to extend your reach to every student, every hour.</p>
          </header>

          <div className="mb-4">
            <RoleToggle value={role} onChange={setRole} />
          </div>

          {generalError && (
            <div className="mb-4 px-3 py-2.5 border border-[var(--flap-cancel)]/50 text-[var(--flap-cancel)] text-sm">
              {generalError}
            </div>
          )}

          <form className="grid gap-3.5" onSubmit={handleSubmit} noValidate>
            <FormInput label="Email" name="email" type="email" value={form.email} onChange={handleChange} error={errors.email} />
            <FormInput label="Password" name="password" type="password" value={form.password} onChange={handleChange} error={errors.password} />

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-1 flex items-center justify-center gap-2 px-4 py-2.5 font-[family-name:var(--font-flap)] font-semibold tracking-[0.12em] uppercase text-[var(--board-steel-deep)] bg-[var(--flap-amber)] border-none disabled:opacity-60 cursor-pointer"
            >
              {submitting ? <span className="spinner" aria-label="Loading" /> : 'Log in'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-[var(--board-rule)]">
            <p className="mb-3 text-center font-[family-name:var(--font-flap)] text-[0.7rem] font-semibold tracking-[0.16em] uppercase text-[var(--flap-mute)]">
              Presentation demo
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDemoLogin('student')}
                className="px-3 py-2.5 font-[family-name:var(--font-flap)] text-xs font-semibold tracking-[0.12em] uppercase text-[var(--flap-ink)] bg-[var(--flap-face)] border border-[var(--board-rule)] disabled:opacity-60 cursor-pointer hover:border-[var(--flap-amber)]"
              >
                Demo student
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDemoLogin('teacher')}
                className="px-3 py-2.5 font-[family-name:var(--font-flap)] text-xs font-semibold tracking-[0.12em] uppercase text-[var(--flap-ink)] bg-[var(--flap-face)] border border-[var(--board-rule)] disabled:opacity-60 cursor-pointer hover:border-[var(--flap-amber)]"
              >
                Demo maths teacher
              </button>
            </div>
          </div>

          <p className="mt-5 text-center text-sm text-[var(--flap-mute)]">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="font-semibold text-[var(--flap-amber)] hover:underline">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default Login
