'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import PButton from '@/components/baseui/pbutton'
import PInput from '@/components/baseui/pinput'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'

interface RedeemResult {
  points_awarded: number
  new_balance: number
  code: string
}

interface PayConfig {
  enabled: boolean
  points_per_credit: number
}

export default function RedeemPage() {
  const { status } = useSession()
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RedeemResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Credit top-up
  const [payConfig, setPayConfig] = useState<PayConfig | null>(null)
  const [credits, setCredits] = useState('100')
  const [topUpLoading, setTopUpLoading] = useState(false)
  const [topUpError, setTopUpError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    clientApiFetch('/pay/config')
      .then((data: PayConfig) => setPayConfig(data))
      .catch(() => setPayConfig(null))
  }, [status])

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

  const creditsNum = Number(credits)
  const creditsValid = Number.isInteger(creditsNum) && creditsNum > 0
  const pointsPerCredit = payConfig?.points_per_credit ?? 100

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!creditsValid) return

    setTopUpLoading(true)
    setTopUpError(null)

    try {
      const data = await clientApiFetch('/pay/intent', {
        method: 'POST',
        body: JSON.stringify({ credits: creditsNum }),
      })
      // Redirect the browser to the Friend Group Auth checkout page.
      window.location.href = (data as { url: string }).url
    } catch (err) {
      setTopUpError(err instanceof Error ? err.message : 'Failed to start payment')
      setTopUpLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="animate-fade-in mb-6">
        <h1 className="mb-1.5 text-2xl font-bold text-zinc-100">Add Points</h1>
        <p className="text-sm text-zinc-500">
          Redeem a gift code or top up with credits.
        </p>
      </div>

      {payConfig?.enabled && (
        <form onSubmit={handleTopUp} className="animate-fade-in mb-6">
          <PDiv fullWidth padding="p-6">
            <h2 className="mb-1 text-lg font-semibold text-zinc-100">Top up with credits</h2>
            <p className="mb-4 text-sm text-zinc-500">
              1 credit = {pointsPerCredit} points.
            </p>

            <div className="mb-4">
              <label htmlFor="topup-credits" className="mb-1.5 block text-sm font-medium text-zinc-300">
                Credits to spend
              </label>
              <PInput
                id="topup-credits"
                type="number"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="100"
                disabled={topUpLoading}
                minWidth="100%"
              />
            </div>

            {creditsValid && (
              <p className="mb-4 text-sm text-zinc-400">
                You’ll receive{' '}
                <span className="font-bold text-blue-300">
                  {(creditsNum * pointsPerCredit).toLocaleString()} points
                </span>{' '}
                for{' '}
                <span className="font-bold text-blue-300">{creditsNum.toLocaleString()} credits</span>.
              </p>
            )}

            {topUpError && (
              <div className="mb-4 border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-400">
                {topUpError}
              </div>
            )}

            <PButton
              type="submit"
              variant="primary"
              fullWidth
              customInnerClass="py-2"
              disabled={topUpLoading || !creditsValid}
              loading={topUpLoading}
              spinnerColor="bg-white"
            >
              {topUpLoading ? 'Redirecting…' : 'Continue to payment'}
            </PButton>
          </PDiv>
        </form>
      )}

      <form onSubmit={handleSubmit} className="animate-fade-in stagger-1">
        <PDiv fullWidth padding="p-6">
          <h2 className="mb-4 text-lg font-semibold text-zinc-100">Redeem a code</h2>
          <div className="mb-4">
            <label htmlFor="redeem-code" className="mb-1.5 block text-sm font-medium text-zinc-300">Code</label>
            <PInput
              id="redeem-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX-XXXX"
              disabled={loading}
              minWidth="100%"
            />
          </div>

          {error && (
            <div className="mb-4 border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-400">
              {error}
            </div>
          )}

          {result && (
            <div className="mb-4 border border-emerald-800 bg-emerald-950/30 px-3 py-3 text-sm">
              <p className="font-semibold text-emerald-400">Code redeemed!</p>
              <p className="mt-1 text-zinc-300">
                You received{' '}
                <span className="font-bold text-blue-300">{result.points_awarded.toLocaleString()} points</span>
                . New balance:{' '}
                <span className="font-bold text-blue-300">{result.new_balance.toLocaleString()} pts</span>
              </p>
            </div>
          )}

          <PButton
            type="submit"
            variant="primary"
            fullWidth
            customInnerClass="py-2"
            disabled={loading || !code.trim()}
            loading={loading}
            spinnerColor="bg-white"
          >
            {loading ? 'Redeeming...' : 'Redeem'}
          </PButton>
        </PDiv>
      </form>
    </div>
  )
}
