import type { Session } from 'next-auth'

// ---------------------------------------------------------------------------
// Server-side fetch helper
// ---------------------------------------------------------------------------
export async function apiFetch(
  path: string,
  options: RequestInit = {},
  session?: Session | null,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }

  if (session) {
    headers['Authorization'] = `Bearer ${process.env.INTERNAL_API_SECRET}`
    headers['X-Discord-Id'] = session.user.discordId
  }

  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const res = await fetch(`${base}/api/v1${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'API error')
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// Client-side fetch helper (no server env access)
// ---------------------------------------------------------------------------
export async function clientApiFetch(
  path: string,
  options: RequestInit = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  }

  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'API error')
  }

  return res.json()
}
