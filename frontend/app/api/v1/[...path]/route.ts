import { auth } from '@/auth'
import { NextRequest, NextResponse } from 'next/server'

const FASTAPI_BASE = 'http://localhost:8124/api/v1'
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET ?? ''

async function proxy(req: NextRequest): Promise<NextResponse> {
  const session = await auth()

  const url = new URL(req.url)
  const downstreamPath = url.pathname.replace(/^\/api\/v1/, '')
  const targetUrl = `${FASTAPI_BASE}${downstreamPath}${url.search}`

  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('Content-Type') ?? 'application/json',
    'Authorization': `Bearer ${INTERNAL_API_SECRET}`,
  }

  if (session?.user) {
    const { discordId, discordUsername, avatar } = session.user
    if (discordId) headers['X-Discord-Id'] = discordId
    if (discordUsername) headers['X-Discord-Username'] = discordUsername
    headers['X-Discord-Avatar'] = avatar ?? ''
  }

  const daemonSecret = req.headers.get('X-Daemon-Secret')
  if (daemonSecret) {
    headers['X-Daemon-Secret'] = daemonSecret
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

  // Pass SSE streams through without buffering
  if (upstream.headers.get('Content-Type')?.includes('text/event-stream')) {
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  const data = await upstream.text()
  return new NextResponse(data || null, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const DELETE = proxy
export const PATCH = proxy
