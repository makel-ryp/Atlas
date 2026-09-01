import { useState } from 'react'
import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  type AuthError,
} from 'firebase/auth'
import { auth } from '../lib/firebase'

// Firebase's codes are stable API, its messages are not — and since 2023 it deliberately returns
// the same code for a wrong password and an unknown email so the form cannot be used to enumerate
// accounts. Mirror that: one message for both.
function messageFor(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password combination is incorrect.'
    case 'auth/invalid-email':
      return 'That email address is not valid.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.'
    case 'auth/network-request-failed':
      return 'Network error — check your connection.'
    // OAuth-only codes. `unauthorized-domain` is a Firebase console setting, not a bug in this
    // app: the host has to be listed under Authentication → Settings → Authorised domains, and
    // nothing in the repo can add it. Say so rather than "sign-in failed", because the fix is
    // somewhere the person reading this message can actually go.
    case 'auth/unauthorized-domain':
      return 'This site is not authorised for Google sign-in yet. Use email and password.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow popups for this site, or use email.'
    case 'auth/account-exists-with-different-credential':
      return 'That email already has a password on it. Sign in with your password instead.'
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this project.'
    default:
      return 'Sign-in failed. Please try again.'
  }
}

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function google() {
    setBusy(true)
    setError(null)
    try {
      // Popup, not redirect. A redirect round-trips through the auth domain and comes back on a
      // fresh page load, which would race the intake gate's one-shot check in App.tsx; the popup
      // resolves in place and `onAuthStateChanged` picks it up exactly like a password sign-in, so
      // nothing downstream needs to know which door was used.
      await signInWithPopup(auth, new GoogleAuthProvider())
      // No setBusy(false) and no navigation on success — same reasoning as the password path: the
      // AuthProvider is the single place that reacts to a session appearing, and this component
      // unmounts underneath it.
    } catch (err) {
      const code = (err as AuthError).code ?? ''
      // Closing the window is a decision, not a failure. Saying "sign-in failed" to someone who
      // deliberately clicked the X reads as a bug they need to solve.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setBusy(false)
        return
      }
      setError(messageFor(code))
      setBusy(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // No navigation on success: onAuthStateChanged in AuthProvider is the single place that
      // reacts to a session appearing, so this component never has to know what comes next.
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      setError(messageFor((err as AuthError).code ?? ''))
      setBusy(false)
    }
  }

  return (
    <main className="auth-shell">
      <h1>Atlas</h1>
      <p className="muted">Sign in with your RYP account.</p>
      <form onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>

      <div className="auth-or" role="separator">
        <span>or</span>
      </div>

      <button type="button" className="btn-oauth" onClick={google} disabled={busy}>
        <svg viewBox="0 0 18 18" aria-hidden focusable="false">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
          <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
        </svg>
        Continue with Google
      </button>
    </main>
  )
}
