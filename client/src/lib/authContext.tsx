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
      let next = await apiFetch<Me>('/api/users/me')

      // Adopt the name the identity provider already knows.
      //
      // eco's attachUser stores firebase_uid and email and nothing else — correct, because it is
      // shared by every RYP app and cannot assume a provider gave a name. A password signup has
      // none to give. Google and Apple do, and without this a golfer who signed in with Google
      // sees their email address in the h1 where their name belongs (Profile.tsx renders
      // `displayName ?? email`), which reads as the app not knowing who they are.
      //
      // Guarded so it happens once and only when there is something to adopt: the server has no
      // name, the provider does. A user who later clears their own name is not re-stamped, because
      // by then the provider name is no longer news — this only ever fires on a row that has never
      // had one.
      const fromProvider = auth.currentUser?.displayName?.trim()
      if (!next.user.displayName && fromProvider) {
        try {
          await apiFetch('/api/users/me', {
            method: 'PATCH',
            body: JSON.stringify({ displayName: fromProvider }),
          })
          next = await apiFetch<Me>('/api/users/me')
        } catch {
          // Cosmetic. A failure here must not block sign-in — the app is perfectly usable showing
          // an email address, and throwing would send a working session to the error screen.
        }
      }

      setMe(next)
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
