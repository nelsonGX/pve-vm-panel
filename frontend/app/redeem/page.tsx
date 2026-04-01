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
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-600 border-t-indigo-500" />
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
      <h1 className="mb-2 text-2xl font-bold text-gray-100">Redeem Code</h1>
      <p className="mb-6 text-sm text-gray-400">
        Enter a gift code to add points to your balance.
      </p>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-gray-800 bg-gray-900 p-6"
      >
        <div className="mb-4">
          <label
            htmlFor="code"
            className="mb-1.5 block text-sm font-medium text-gray-300"
          >
            Code
          </label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-sm text-gray-100 placeholder-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {result && (
          <div className="mb-4 rounded border border-green-800 bg-green-900/20 px-3 py-3 text-sm">
            <p className="font-semibold text-green-400">Code redeemed!</p>
            <p className="mt-1 text-gray-300">
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
          className="w-full rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Redeeming...' : 'Redeem'}
        </button>
      </form>
    </div>
  )
}
