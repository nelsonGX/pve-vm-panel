'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'

interface VerifyResult {
  status: string
  paid: boolean
  points_awarded?: number
  new_balance?: number
  already_credited?: boolean
}

const FAILURE_MESSAGES: Record<string, string> = {
  cancelled: 'Payment was cancelled. No credits were charged.',
  insufficient_funds: 'You don’t have enough credits for this top-up.',
  access_denied: 'Payment was denied.',
}

function PayReturnContent() {
  const { status: authStatus } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const intentId = searchParams.get('intent_id')

  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const verified = useRef(false)

  useEffect(() => {
    if (authStatus === 'loading') return
    if (authStatus === 'unauthenticated') {
      router.replace('/login')
      return
    }
    if (!intentId) return
    if (verified.current) return
    verified.current = true

    clientApiFetch('/pay/verify', {
      method: 'POST',
      body: JSON.stringify({ intent_id: intentId }),
    })
      .then((data: VerifyResult) => setResult(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not verify payment'))
      .finally(() => setLoading(false))
  }, [authStatus, intentId, router])

  if (authStatus === 'loading' || authStatus === 'unauthenticated') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelSpinner color="bg-blue-400" size={10} />
      </div>
    )
  }

  // Verification is still in flight (only runs when an intent id is present).
  if (intentId && loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mb-3 flex justify-center">
            <PixelSpinner color="bg-blue-400" size={10} />
          </div>
          <p className="text-zinc-400">Confirming your payment…</p>
        </div>
      </div>
    )
  }

  const succeeded = result?.paid === true
  const statusKey = result?.status ?? ''
  const failureMessage = !intentId
    ? 'Missing payment reference.'
    : error ?? FAILURE_MESSAGES[statusKey] ?? 'Payment was not completed.'

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <PDiv fullWidth padding="p-6">
        {succeeded ? (
          <>
            <h1 className="mb-1.5 text-2xl font-bold text-emerald-400">Payment complete</h1>
            <p className="text-sm text-zinc-400">Your points have been added.</p>
            <div className="mt-4 border border-emerald-800 bg-emerald-950/30 px-3 py-3 text-sm">
              {result?.already_credited ? (
                <p className="text-zinc-300">This payment was already credited to your account.</p>
              ) : (
                <p className="text-zinc-300">
                  You received{' '}
                  <span className="font-bold text-blue-300">
                    {(result?.points_awarded ?? 0).toLocaleString()} points
                  </span>
                  .
                </p>
              )}
              {typeof result?.new_balance === 'number' && (
                <p className="mt-1 text-zinc-300">
                  New balance:{' '}
                  <span className="font-bold text-blue-300">
                    {result.new_balance.toLocaleString()} pts
                  </span>
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="mb-1.5 text-2xl font-bold text-red-400">Payment not completed</h1>
            <div className="mt-4 border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-400">
              {failureMessage}
            </div>
          </>
        )}

        <div className="mt-5 flex gap-2">
          <PButton variant="primary" fullWidth customInnerClass="py-2" onClick={() => router.push('/')}>
            Back to dashboard
          </PButton>
          {!succeeded && (
            <PButton variant="gray" fullWidth customInnerClass="py-2" onClick={() => router.push('/redeem')}>
              Try again
            </PButton>
          )}
        </div>
      </PDiv>
    </div>
  )
}

export default function PayReturnClient() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <PixelSpinner color="bg-blue-400" size={10} />
        </div>
      }
    >
      <PayReturnContent />
    </Suspense>
  )
}
