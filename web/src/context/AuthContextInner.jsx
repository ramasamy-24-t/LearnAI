'use client'

import PropTypes from 'prop-types'
import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { demoLoginRequest, fetchTeacherProfile, loginRequest } from '../services/api.js'

export const AuthContext = createContext(undefined)

export function accountRole(user, fallback = '') {
  return String(user?.role || fallback || '').trim().toLowerCase()
}

/** Compute where to send a user after login / OTP / onboarding update */
export function resolveRoute(user) {
  if (!user) return '/login'
  const role = accountRole(user)
  if (role === 'student') return '/student'
  if (role === 'teacher') {
    if (!user.onboarding_completed) return '/teacher-onboarding'
    return '/teacher'
  }
  return '/login'
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [role, setRole] = useState('teacher')
  const [authReady, setAuthReady] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const storedUser = localStorage.getItem('authUser')
    const storedToken = localStorage.getItem('authToken')
    const storedRole = localStorage.getItem('authRole')
    let parsedUser = null
    if (storedUser) {
      try {
        parsedUser = JSON.parse(storedUser)
      } catch {
        parsedUser = null
      }
    }
    setUser(parsedUser)
    setToken(storedToken)
    setRole(accountRole(parsedUser, storedRole) || 'teacher')
    setAuthReady(true)
  }, [])

  const persist = useCallback((nextToken, nextUser, nextRole) => {
    if (typeof window === 'undefined') return
    if (nextToken) localStorage.setItem('authToken', nextToken)
    else localStorage.removeItem('authToken')
    if (nextUser) localStorage.setItem('authUser', JSON.stringify(nextUser))
    else localStorage.removeItem('authUser')
    if (nextRole) localStorage.setItem('authRole', nextRole)
    else localStorage.removeItem('authRole')
  }, [])

  const setAuthSession = useCallback((nextToken, nextUser, nextRole) => {
    const resolvedRole = accountRole(nextUser, nextRole)
    setToken(nextToken)
    setUser(nextUser)
    setRole(resolvedRole)
    persist(nextToken, nextUser, resolvedRole)
  }, [persist])

  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = prev ? { ...prev, ...patch } : { ...patch }
      localStorage.setItem('authUser', JSON.stringify(next))
      const nextRole = accountRole(next)
      if (nextRole) localStorage.setItem('authRole', nextRole)
      return next
    })
  }, [])

  useEffect(() => {
    if (!token) return
    if (accountRole(user, role) !== 'teacher') return
    if (!user?.id) return

    let cancelled = false
    async function loadTeacherProfile() {
      const { data, error } = await fetchTeacherProfile()
      if (cancelled) return
      if (error) return

      const profile = data?.profile || null
      const avatarUrl = profile?.avatar_url || ''
      const onboardingCompleted = Boolean(profile?.onboarding_completed)

      const patch = {}
      if (avatarUrl && avatarUrl !== user?.avatar_url) patch.avatar_url = avatarUrl
      if (typeof profile?.onboarding_completed === 'boolean' && onboardingCompleted !== Boolean(user?.onboarding_completed)) {
        patch.onboarding_completed = onboardingCompleted
      }

      if (Object.keys(patch).length > 0) updateUser(patch)
    }

    loadTeacherProfile()
    return () => { cancelled = true }
  }, [role, token, updateUser, user?.avatar_url, user?.id, user?.onboarding_completed, user?.role])

  const applyLoginResult = useCallback(
    (data, fallbackRole) => {
      const nextToken = data.token || data.access_token || null
      const nextUser = data.user || null
      const nextRole = accountRole(nextUser, fallbackRole)
      const redirectTo = resolveRoute(nextUser)

      flushSync(() => {
        setAuthSession(nextToken, nextUser, nextRole)
      })
      router.replace(redirectTo)

      return { ok: true, error: null, redirectTo }
    },
    [router, setAuthSession],
  )

  const login = useCallback(
    async ({ email, password, role: loginRole }) => {
      const payload = { email, password, role: loginRole }
      const { data, error } = await loginRequest(payload)
      if (error) return { ok: false, error, redirectTo: null }
      return applyLoginResult(data, loginRole)
    },
    [applyLoginResult],
  )

  const loginDemo = useCallback(
    async (demoRole) => {
      const { data, error } = await demoLoginRequest(demoRole)
      if (error) return { ok: false, error, redirectTo: null }
      return applyLoginResult(data, demoRole)
    },
    [applyLoginResult],
  )

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setRole('teacher')
    persist(null, null, null)
    router.replace('/login')
  }, [router, persist])

  const value = useMemo(
    () => ({
      user,
      token,
      role: accountRole(user, role),
      login,
      loginDemo,
      logout,
      updateUser,
      setAuthSession,
      isAuthenticated: Boolean(token),
      authReady,
    }),
    [authReady, login, loginDemo, logout, role, setAuthSession, token, updateUser, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

AuthProvider.propTypes = {
  children: PropTypes.node.isRequired,
}
