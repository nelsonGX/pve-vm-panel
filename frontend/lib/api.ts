import type { Session } from 'next-auth'

const INTERNAL_API_BASE = process.env.INTERNAL_API_BASE ?? 'http://localhost:8124/api/v1'

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
    headers['X-Discord-Username'] = session.user.discordUsername
    headers['X-Discord-Avatar'] = session.user.avatar ?? ''
  }

  const res = await fetch(`${INTERNAL_API_BASE}${path}`, {
    ...options,
    headers,
    cache: 'no-store',
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'API error')
  }

  if (res.status === 204) return null
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

  if (res.status === 204) return null
  return res.json()
}
