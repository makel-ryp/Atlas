import { useState } from 'react'
import { signInWithEmailAndPassword, type AuthError } from 'firebase/auth'
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
    default:
      return 'Sign-in failed. Please try again.'
  }
}

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    </main>
  )
}
