'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Circle, Copy, X } from 'lucide-react'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'
import { toast } from '@/components/baseui/toast-manager'

export type StepStatus = 'pending' | 'loading' | 'done' | 'error'

export interface ProvisioningStep {
  key?: string
  label: string
  status: StepStatus
}

export interface VMCredentials {
  ip_address: string
  username: string
  password: string
  expires_at: string
}

interface ProvisioningModalProps {
  open: boolean
  steps: ProvisioningStep[]
  credentials?: VMCredentials | null
  error?: string | null
  onClose?: () => void
}

const STEP_ICONS: Record<StepStatus, React.ReactNode> = {
  pending: (
    <span className="flex h-5 w-5 items-center justify-center text-zinc-600">
      <Circle className="h-4 w-4" />
    </span>
  ),
  loading: (
    <span className="flex h-5 w-5 items-center justify-center">
      <PixelSpinner color="bg-white" />
    </span>
  ),
  done: (
    <span className="flex h-5 w-5 items-center justify-center text-emerald-400">
      <Check className="h-3.5 w-3.5" />
    </span>
  ),
  error: (
    <span className="flex h-5 w-5 items-center justify-center text-red-400">
      <X className="h-3.5 w-3.5" />
    </span>
  ),
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-2 inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-700"
    >
      <Copy className="h-3 w-3" />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function ProvisioningModal({
  open,
  steps,
  credentials,
  error,
  onClose,
}: ProvisioningModalProps) {
  const shownErrorRef = useRef<string | null>(null)
  const shownCredentialsRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      shownErrorRef.current = null
      shownCredentialsRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open || !error || shownErrorRef.current === error) return
    shownErrorRef.current = error
    toast.error(error, { autoClose: false })
  }, [open, error])

  useEffect(() => {
    const credentialKey = credentials
      ? `${credentials.ip_address}:${credentials.expires_at}`
      : null
    if (!open || !credentialKey || shownCredentialsRef.current === credentialKey) return
    shownCredentialsRef.current = credentialKey
    toast.warning("You won't be able to see these credentials again. Copy them somewhere safe.", {
      autoClose: false,
    })
  }, [open, credentials])

  if (!open) return null

  const hasError = !!error || steps.some((s) => s.status === 'error')
  const isDone = !!credentials

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="animate-scale-in w-full max-w-lg">
        <PDiv fullWidth padding="p-6">
          <h2 className="mb-1 text-lg font-semibold text-zinc-100">
            {isDone ? 'VM Ready' : hasError ? 'Provisioning Failed' : 'Provisioning VM...'}
          </h2>
          {!isDone && !hasError && (
            <p className="mb-4 text-sm text-zinc-500">This may take a minute...</p>
          )}

          <div className="mb-6 flex flex-col gap-3">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {STEP_ICONS[step.status]}
                <span className={`text-sm ${
                  step.status === 'done' ? 'text-emerald-400'
                  : step.status === 'error' ? 'text-red-400'
                  : step.status === 'loading' ? 'text-zinc-200'
                  : 'text-zinc-600'
                }`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>

          {credentials && (
            <div className="mb-4 border border-emerald-800 bg-emerald-950/30 p-4">
              <p className="mb-3 text-sm font-medium text-emerald-400">
                Your VM is ready. Credentials below:
              </p>
              <div className="flex flex-col gap-2 font-mono text-sm">
                <div className="flex items-center">
                  <span className="w-24 text-zinc-500">IP</span>
                  <span className="text-zinc-200">{credentials.ip_address}</span>
                  <CopyButton text={credentials.ip_address} />
                </div>
                <div className="flex items-center">
                  <span className="w-24 text-zinc-500">Username</span>
                  <span className="text-zinc-200">{credentials.username}</span>
                  <CopyButton text={credentials.username} />
                </div>
                <div className="flex items-center">
                  <span className="w-24 text-zinc-500">Password</span>
                  <span className="text-zinc-200">{credentials.password}</span>
                  <CopyButton text={credentials.password} />
                </div>
                <div className="flex items-center">
                  <span className="w-24 text-zinc-500">Expires</span>
                  <span className="text-zinc-400">{new Date(credentials.expires_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {(isDone || hasError) && onClose && (
            <PButton variant="primary" fullWidth customInnerClass="py-2.5" onClick={onClose}>
              {isDone ? 'Go to My VMs' : 'Close'}
            </PButton>
          )}
        </PDiv>
      </div>
    </div>
  )
}
