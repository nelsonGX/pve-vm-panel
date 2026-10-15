'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Copy } from 'lucide-react'
import { clientApiFetch } from '@/lib/api'
import PButton from '@/components/baseui/pbutton'
import PInput from '@/components/baseui/pinput'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'
import ConfirmDialog from '@/components/ConfirmDialog'
import { toast } from '@/components/baseui/toast-api'

interface ApiToken {
  id: string
  name: string
  token_hint: string
  created_at: string
  last_used_at: string | null
}

const SERVER_NAME = 'pve-vm-panel'

const subscribeNoop = () => () => {}
const getOrigin = () => window.location.origin
const getServerOrigin = () => ''

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied to clipboard`)
  } catch {
    toast.error('Could not copy to clipboard')
  }
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto border border-zinc-700 bg-zinc-950 p-3 pr-10 text-xs text-zinc-300 whitespace-pre">
        {code}
      </pre>
      <button
        type="button"
        onClick={() => copy(code, label)}
        className="absolute right-2 top-2 p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
        aria-label={`Copy ${label}`}
      >
        <Copy size={14} />
      </button>
    </div>
  )
}

export default function McpPageClient() {
  const { status } = useSession()
  const router = useRouter()
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null)
  const [revoking, setRevoking] = useState(false)
  const origin = useSyncExternalStore(subscribeNoop, getOrigin, getServerOrigin)

  const loadTokens = useCallback(() => {
    clientApiFetch('/me/api-tokens')
      .then((data: ApiToken[]) => setTokens(data))
      .catch(() => setTokens([]))
  }, [])

  useEffect(() => {
    if (status === 'authenticated') loadTokens()
  }, [status, loadTokens])

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelSpinner color="bg-blue-400" size={10} />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  const endpoint = `${origin}/api/mcp`
  const tokenForSnippet = newToken ?? '<YOUR_API_TOKEN>'

  const claudeCodeCmd =
    `claude mcp add --transport http ${SERVER_NAME} ${endpoint} \\\n` +
    `  --header "Authorization: Bearer ${tokenForSnippet}"`

  const jsonConfig = JSON.stringify(
    {
      mcpServers: {
        [SERVER_NAME]: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${tokenForSnippet}` },
        },
      },
    },
    null,
    2,
  )

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setCreating(true)
    setError(null)
    try {
      const data = await clientApiFetch('/me/api-tokens', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      })
      setNewToken((data as { token: string }).token)
      setName('')
      loadTokens()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      await clientApiFetch(`/me/api-tokens/${revokeTarget.id}`, { method: 'DELETE' })
      toast.success(`Revoked "${revokeTarget.name}"`)
      loadTokens()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke token')
    } finally {
      setRevoking(false)
      setRevokeTarget(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="animate-fade-in mb-6">
        <h1 className="mb-1.5 text-2xl font-bold text-zinc-100">AI Agents (MCP)</h1>
        <p className="text-sm text-zinc-500">
          Let AI assistants like Claude list, create, start, stop, renew and delete your VMs
          through the Model Context Protocol. Agents act as you and spend your points.
        </p>
      </div>

      <form onSubmit={handleCreate} className="animate-fade-in mb-6">
        <PDiv fullWidth padding="p-6">
          <h2 className="mb-4 text-lg font-semibold text-zinc-100">Create an API token</h2>
          <div className="mb-4">
            <label htmlFor="token-name" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Name
            </label>
            <PInput
              id="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Claude Code on laptop"
              disabled={creating}
              minWidth="100%"
            />
          </div>

          {error && (
            <div className="mb-4 border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          {newToken && (
            <div className="mb-4 border border-emerald-800 bg-emerald-950/30 px-3 py-3 text-sm">
              <p className="mb-2 font-semibold text-emerald-400">
                Token created. Copy it now, it won{"'"}t be shown again.
              </p>
              <CodeBlock code={newToken} label="Token" />
            </div>
          )}

          <PButton
            type="submit"
            variant="primary"
            fullWidth
            customInnerClass="py-2"
            disabled={creating || !name.trim()}
            loading={creating}
            spinnerColor="bg-white"
          >
            {creating ? 'Creating...' : 'Create token'}
          </PButton>
        </PDiv>
      </form>

      <div className="animate-fade-in stagger-1 mb-6">
        <PDiv fullWidth padding="p-6">
          <h2 className="mb-1 text-lg font-semibold text-zinc-100">Connect</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Streamable HTTP endpoint: <span className="text-blue-300">{endpoint}</span>
          </p>

          <h3 className="mb-1.5 text-sm font-medium text-zinc-300">Claude Code</h3>
          <div className="mb-4">
            <CodeBlock code={claudeCodeCmd} label="Command" />
          </div>

          <h3 className="mb-1.5 text-sm font-medium text-zinc-300">
            JSON config (Cursor, Claude Code .mcp.json, other clients)
          </h3>
          <CodeBlock code={jsonConfig} label="Config" />
        </PDiv>
      </div>

      <div className="animate-fade-in stagger-2">
        <PDiv fullWidth padding="p-6">
          <h2 className="mb-4 text-lg font-semibold text-zinc-100">Your tokens</h2>
          {tokens === null ? (
            <PixelSpinner color="bg-zinc-500" size={6} />
          ) : tokens.length === 0 ? (
            <p className="text-sm text-zinc-500">No tokens yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{t.name}</p>
                    <p className="text-xs text-zinc-500">
                      <span className="font-mono">{t.token_hint}</span>
                      {' · '}
                      {t.last_used_at
                        ? `last used ${new Date(t.last_used_at).toLocaleString()}`
                        : 'never used'}
                    </p>
                  </div>
                  <PButton variant="danger" onClick={() => setRevokeTarget(t)}>
                    Revoke
                  </PButton>
                </li>
              ))}
            </ul>
          )}
        </PDiv>
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke token"
        message={`Agents using "${revokeTarget?.name ?? ''}" will immediately lose access.`}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
        confirmLoading={revoking}
        confirmLabel="Revoke"
        danger
      />
    </div>
  )
}
