'use client'

import { useState } from 'react'

export type StepStatus = 'pending' | 'loading' | 'done' | 'error'

export interface ProvisioningStep {
  label: string
  status: StepStatus
}

export interface VMCredentials {
  ip: string
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
    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-600 text-gray-500 text-xs">
      ·
    </span>
  ),
  loading: (
    <span className="flex h-5 w-5 items-center justify-center">
      <svg
        className="h-4 w-4 animate-spin text-indigo-400"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
        />
      </svg>
    </span>
  ),
  done: (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-800 text-green-400 text-xs font-bold">
      ✓
    </span>
  ),
  error: (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-900 text-red-400 text-xs font-bold">
      ✕
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
      className="ml-2 rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300 transition-colors hover:bg-gray-600"
    >
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
  if (!open) return null

  const hasError = !!error || steps.some((s) => s.status === 'error')
  const isDone = !!credentials

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-100">
          {isDone ? 'VM Ready' : hasError ? 'Provisioning Failed' : 'Provisioning VM...'}
        </h2>

        {/* Steps */}
        <div className="mb-6 flex flex-col gap-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              {STEP_ICONS[step.status]}
              <span
                className={`text-sm ${
                  step.status === 'done'
                    ? 'text-green-400'
                    : step.status === 'error'
                    ? 'text-red-400'
                    : step.status === 'loading'
                    ? 'text-gray-200'
                    : 'text-gray-500'
                }`}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded bg-red-900/50 border border-red-800 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Credentials */}
        {credentials && (
          <div className="mb-4 rounded border border-green-800 bg-green-900/20 p-4">
            <p className="mb-3 text-sm font-medium text-green-400">
              Your VM is ready. Credentials below:
            </p>
            <div className="flex flex-col gap-2 font-mono text-sm">
              <div className="flex items-center">
                <span className="w-24 text-gray-500">IP</span>
                <span className="text-gray-200">{credentials.ip}</span>
                <CopyButton text={credentials.ip} />
              </div>
              <div className="flex items-center">
                <span className="w-24 text-gray-500">Username</span>
                <span className="text-gray-200">{credentials.username}</span>
                <CopyButton text={credentials.username} />
              </div>
              <div className="flex items-center">
                <span className="w-24 text-gray-500">Password</span>
                <span className="text-gray-200">{credentials.password}</span>
                <CopyButton text={credentials.password} />
              </div>
              <div className="flex items-center">
                <span className="w-24 text-gray-500">Expires</span>
                <span className="text-gray-400">
                  {new Date(credentials.expires_at).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Close button */}
        {(isDone || hasError) && onClose && (
          <button
            onClick={onClose}
            className="w-full rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {isDone ? 'Go to My VMs' : 'Close'}
          </button>
        )}
      </div>
    </div>
  )
}
