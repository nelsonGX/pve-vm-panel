import { NextRequest, NextResponse } from 'next/server'

// Public MCP endpoint for AI agents. Unlike /api/v1/*, this does not use the
// NextAuth session: the client's own `Authorization: Bearer pvp_...` API token
// is forwarded untouched and verified by the backend.

const FASTAPI_BASE = process.env.INTERNAL_API_BASE ?? 'http://localhost:8124/api/v1'

const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'accept',
  'content-type',
  'last-event-id',
  'mcp-session-id',
  'mcp-protocol-version',
]

const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'mcp-session-id',
  'mcp-protocol-version',
  'www-authenticate',
  'allow',
]

async function proxy(req: NextRequest): Promise<Response> {
  const headers: Record<string, string> = {}
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers[name] = value
  }

  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.text()
      : undefined

  let upstream: Response
  try {
    upstream = await fetch(`${FASTAPI_BASE}/mcp/`, {
      method: req.method,
      headers,
      body,
      signal: req.signal,
    })
  } catch {
    return NextResponse.json(
      { detail: `Backend API is unreachable at ${FASTAPI_BASE}` },
      { status: 502 },
    )
  }

  const responseHeaders = new Headers({ 'X-Accel-Buffering': 'no' })
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }

  // Stream the body through: tool calls like create_vm answer over SSE.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export const GET = proxy
export const POST = proxy
export const DELETE = proxy
