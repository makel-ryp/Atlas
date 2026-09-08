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
    // ── END THE SERVER SESSION, NOT JUST THE CLIENT ONE ──────────────────────────────────────
    // Firebase's signOut clears the ID token this tab holds. It does NOT touch the httpOnly
    // session cookie that POST /api/session mints for the served prototype — that cookie lives 8
    // hours, is sameSite 'lax' (so a top-level navigation sends it), and by itself authenticates
    // both /proto/dashboard and every /api/coach/* route via `cookieOrBearer`.
    //
    // So before this, a coach signing out of a shared laptop left the next person able to type
    // /proto/dashboard and read their whole roster — real student names, emails and handicaps.
    // The endpoint to close it has existed since the session was introduced and had zero callers.
    //
    // Order matters: end the server session FIRST, while the ID token is still valid. The reverse
    // order leaves nothing to authenticate the request with.
    //
    // Failure here must not strand the user on a signed-in screen, so it is caught — but it is
    // caught LOUDLY into the error slot rather than swallowed, because a cookie that outlived a
    // sign-out is exactly the thing someone needs to know about.
    let sessionEnded = true
    try {
      await apiFetch('/api/session/end', { method: 'POST' })
    } catch {
      sessionEnded = false
    }

    try {
      await signOut(auth)
    } finally {
      // `finally`, not the happy path: if signOut rejects — offline, token already expired — the
      // old code left status 'signed_in' and the button did nothing at all, silently. Locally
      // signed out is the honest state either way; Firebase reconciles on reconnect.
      setMe(null)
      setError(sessionEnded ? null : 'Signed out here, but the dashboard session may still be open on this device.')
      setStatus('signed_out')
    }
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
