import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, type User as FirebaseUser } from 'firebase/auth'
import { auth } from './firebase'
import { apiFetch, ApiError } from './api'
import type { Me } from './types'

type Status = 'loading' | 'signed_out' | 'signed_in' | 'no_atlas_access' | 'error'

interface AuthContextValue {
  status: Status
  me: Me | null
  error: string | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setMe(await apiFetch<Me>('/api/users/me'))
      setStatus('signed_in')
      setError(null)
    } catch (err) {
      // 403 app_access_denied is NOT a failure — it is the entitlement gate working. The person
      // authenticated fine and a public.users row now exists (attachUser created it); they simply
      // hold no role in 'atlas'. Distinguished from a real error so the UI can say so honestly
      // instead of showing "something went wrong" for a correct, expected outcome.
      if (err instanceof ApiError && err.status === 403) {
        setMe(null)
        setStatus('no_atlas_access')
        return
      }
      setMe(null)
      setStatus('error')
      setError(err instanceof Error ? err.message : 'unknown error')
    }
  }, [])

  useEffect(() => {
    // Fires once on mount with the restored session (or null), then on every sign-in/out. Do not
    // read auth.currentUser directly before this resolves — it is null while Firebase is still
    // rehydrating from storage, which would flash the login screen at an already-signed-in user.
    return onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      if (!fbUser) {
        setMe(null)
        setError(null)
        setStatus('signed_out')
        return
      }
      setStatus('loading')
      await load()
    })
  }, [load])

  // Deliberately does NOT signOut on no_atlas_access, unlike Locker Room. Atlas is the front door:
  // a signed-in person without access should see what to do about it, not get bounced back to a
  // login form that will succeed and bounce them again.
  const logout = useCallback(async () => {
    await signOut(auth)
    setMe(null)
    setStatus('signed_out')
  }, [])

  return (
    <AuthContext.Provider value={{ status, me, error, refresh: load, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
