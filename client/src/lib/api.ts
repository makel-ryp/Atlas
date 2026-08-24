import { auth } from './firebase'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`)
  }
}

/**
 * Authed fetch. Attaches the Firebase ID token as a Bearer header — the SPA pattern eco's
 * verifyToken expects (verifySessionCookie is for server-rendered apps; Atlas is neither).
 *
 * getIdToken() returns the cached token and refreshes it only when it is close to expiry, so
 * calling this per request is correct rather than wasteful. Tokens last an hour; without the
 * refresh, an open tab starts 401ing after that.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser
  if (!user) throw new ApiError(401, 'not_signed_in')
  const token = await user.getIdToken()

  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  })

  if (!res.ok) {
    // The server always answers /api/* as JSON, in both environments, so a parse failure here
    // means something other than the API replied — worth surfacing as its own code.
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, (body as { error?: string })?.error ?? 'unexpected_response')
  }
  return (await res.json()) as T
}
