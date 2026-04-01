import { getToken } from 'next-auth/jwt'
import { NextRequest, NextResponse } from 'next/server'

const FASTAPI_BASE = 'http://localhost:8124/api/v1'
const COOKIE_NAME = 'authjs.session-token'
const SECRET = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? ''

async function proxy(req: NextRequest): Promise<NextResponse> {
  const token = await getToken({
    req,
    secret: SECRET,
    cookieName: COOKIE_NAME,
    salt: COOKIE_NAME,
  })

  const url = new URL(req.url)
  const downstreamPath = url.pathname.replace(/^\/api\/v1/, '')
  const targetUrl = `${FASTAPI_BASE}${downstreamPath}${url.search}`

  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('Content-Type') ?? 'application/json',
  }

  const discordId = token?.discordId as string | undefined
  if (discordId) {
    headers['X-Discord-Id'] = discordId
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
