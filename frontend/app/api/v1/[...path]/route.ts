import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

const FASTAPI_BASE = 'http://localhost:8000/api/v1'

async function proxy(req: NextRequest): Promise<NextResponse> {
  const session = await auth()

  // Strip the /api/v1 prefix to get the downstream path
  const url = new URL(req.url)
  const downstreamPath = url.pathname.replace(/^\/api\/v1/, '')
  const targetUrl = `${FASTAPI_BASE}${downstreamPath}${url.search}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (session?.user?.discordId) {
    headers['Authorization'] = `Bearer ${process.env.INTERNAL_API_SECRET}`
    headers['X-Discord-Id'] = session.user.discordId
  }

  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.text()
      : undefined

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  })

  const data = await upstream.text()
  return new NextResponse(data, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const DELETE = proxy
export const PATCH = proxy
