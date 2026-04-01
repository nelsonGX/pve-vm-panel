'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'

interface RedeemResult {
  points_awarded: number
  new_balance: number
  code: string
}

export default function RedeemPage() {
  const { status } = useSession()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RedeemResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-indigo-500" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const data = await clientApiFetch('/redeem', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      })
      setResult(data as RedeemResult)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to redeem code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="animate-fade-in mb-6">
        <h1 className="mb-1.5 text-2xl font-bold text-zinc-100">Redeem Code</h1>
        <p className="text-sm text-zinc-500">
          Enter a gift code to add points to your balance.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="animate-fade-in stagger-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-sm"
      >
        <div className="mb-4">
          <label
            htmlFor="code"
            className="mb-1.5 block text-sm font-medium text-zinc-300"
          >
            Code
          </label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2.5 text-sm text-red-400">
            {error}
          </div>
        )}

        {result && (
          <div className="mb-4 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-3 text-sm">
            <p className="font-semibold text-emerald-400">Code redeemed!</p>
            <p className="mt-1 text-zinc-300">
              You received{' '}
              <span className="font-bold text-indigo-300">
                {result.points_awarded.toLocaleString()} points
              </span>
              . New balance:{' '}
              <span className="font-bold text-indigo-300">
                {result.new_balance.toLocaleString()} pts
              </span>
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Redeeming...' : 'Redeem'}
        </button>
      </form>
    </div>
  )
}
