'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Circle, Copy, Download, X } from 'lucide-react'
import type { StepStatus } from './ProvisioningModal'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'
import { toast } from '@/components/baseui/toast-manager'

export interface PrepStep {
  key: string
  label: string
  status: StepStatus
}

export interface BulkVMStatus {
  currentStep: string
  status: StepStatus
}

export interface BulkCredential {
  vm_index: number
  ip_address: string
  username: string
  password: string
  expires_at: string
}

interface BulkProvisioningModalProps {
  open: boolean
  vmCount: number
  hasPrepSteps: boolean
  prepSteps: PrepStep[]
  vmStatuses: BulkVMStatus[]
  credentials: BulkCredential[]
  errors: { vm_index: number; message: string }[]
  fatalError: string | null
  onClose?: () => void
}

const STEP_ICON: Record<StepStatus, React.ReactNode> = {
  pending: (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-zinc-600">
      <Circle className="h-4 w-4" />
    </span>
  ),
  loading: (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
      <PixelSpinner color="bg-white" />
    </span>
  ),
  done: (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-emerald-400">
      <Check className="h-3.5 w-3.5" />
    </span>
  ),
  error: (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-red-400">
      <X className="h-3.5 w-3.5" />
    </span>
  ),
}

const STEP_LABELS: Record<string, string> = {
  stop_source: 'Stopping source VM',
  clone_template: 'Cloning to template',
  convert_template: 'Converting to template',
  start_source: 'Restarting source VM',
  clone: 'Cloning',
  configure: 'Configuring',
  start: 'Starting',
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="ml-1.5 inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-700"
    >
      <Copy className="h-3 w-3" />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

function downloadCSV(credentials: BulkCredential[]) {
  const sorted = [...credentials].sort((a, b) => a.vm_index - b.vm_index)
  const header = 'VM#,IP Address,Username,Password,Expires At'
  const rows = sorted.map(
    (c) => `${c.vm_index + 1},${c.ip_address},${c.username},${c.password},${new Date(c.expires_at).toLocaleString()}`,
  )
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bulk-vms-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function BulkProvisioningModal({
  open,
  vmCount,
  hasPrepSteps,
  prepSteps,
  vmStatuses,
  credentials,
  errors,
  fatalError,
  onClose,
}: BulkProvisioningModalProps) {
  const shownFatalErrorRef = useRef<string | null>(null)
  const shownCredentialsRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      shownFatalErrorRef.current = null
      shownCredentialsRef.current = null
    }
  }, [open])

  useEffect(() => {
    if (!open || !fatalError || shownFatalErrorRef.current === fatalError) return
    shownFatalErrorRef.current = fatalError
    toast.error(fatalError, { autoClose: false })
  }, [open, fatalError])

  useEffect(() => {
    const credentialKey =
      open && credentials.length > 0
        ? credentials
            .map((credential) => `${credential.vm_index}:${credential.expires_at}`)
            .sort()
            .join('|')
        : null
    if (!credentialKey || shownCredentialsRef.current === credentialKey) return
    shownCredentialsRef.current = credentialKey
    toast.warning("Save these credentials now. You won't be able to see them again.", {
      autoClose: false,
    })
  }, [open, credentials])

  if (!open) return null

  const doneCount = credentials.length
  const errorCount = errors.length
  const total = vmCount
  const finished = doneCount + errorCount
  const isDone = finished === total && total > 0
  const hasFatal = !!fatalError
  const sortedCredentials = [...credentials].sort((a, b) => a.vm_index - b.vm_index)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="animate-scale-in w-full max-w-2xl" style={{ maxHeight: '90vh' }}>
        <PDiv fullWidth padding="p-0" innerClassName="flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
          <div className="shrink-0 border-b-2 border-zinc-700 p-6 pb-4">
            <h2 className="mb-1 text-lg font-semibold text-zinc-100">
              {hasFatal
                ? 'Bulk Create Failed'
                : isDone
                ? `Bulk Create Complete - ${doneCount}/${total} succeeded`
                : `Creating ${total} VMs... (${finished}/${total} done)`}
            </h2>
            {!isDone && !hasFatal && (
              <p className="text-sm text-zinc-500">This may take several minutes.</p>
            )}
            {total > 0 && (
              <div className="mt-3 h-3 w-full overflow-hidden border border-zinc-700 bg-zinc-800">
                <div
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${(finished / total) * 100}%` }}
                />
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 pt-4">
            {hasPrepSteps && prepSteps.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Template Preparation
                </p>
                <div className="flex flex-col gap-2 border border-zinc-700 bg-zinc-800/40 p-3">
                  {prepSteps.map((step) => (
                    <div key={step.key} className="flex items-center gap-2.5">
                      {STEP_ICON[step.status]}
                      <span
                        className={`text-sm ${
                          step.status === 'done'
                            ? 'text-emerald-400'
                            : step.status === 'error'
                              ? 'text-red-400'
                              : step.status === 'loading'
                                ? 'text-zinc-200'
                                : 'text-zinc-600'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vmStatuses.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  VM Provisioning
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {vmStatuses.map((vm, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-2 border px-3 py-2 text-sm ${
                        vm.status === 'done'
                          ? 'border-emerald-800 bg-emerald-950/30'
                          : vm.status === 'error'
                            ? 'border-red-800 bg-red-950/30'
                            : vm.status === 'loading'
                              ? 'border-blue-800 bg-blue-950/30'
                              : 'border-zinc-800 bg-zinc-800/30'
                      }`}
                    >
                      {STEP_ICON[vm.status]}
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-zinc-300">VM {index + 1}</span>
                        {vm.currentStep !== 'waiting' && (
                          <span className="ml-1 text-xs text-zinc-500">
                            {STEP_LABELS[vm.currentStep] ?? vm.currentStep}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {errors.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {errors.map((errorItem) => (
                      <p key={errorItem.vm_index} className="text-xs text-red-400">
                        VM {errorItem.vm_index + 1}: {errorItem.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {sortedCredentials.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                    Credentials
                  </p>
                  <PButton
                    variant="secondary"
                    customInnerClass="py-0.5"
                    onClick={() => downloadCSV(sortedCredentials)}
                  >
                    <span className="flex items-center gap-1.5">
                      <Download className="h-3.5 w-3.5" />
                      Download CSV
                    </span>
                  </PButton>
                </div>
                <div className="border border-zinc-700 bg-zinc-800/30">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-700">
                          {['#', 'IP Address', 'Username', 'Password', 'Expires'].map((heading) => (
                            <th
                              key={heading}
                              className="px-3 py-2 text-left font-semibold text-zinc-500"
                            >
                              {heading}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedCredentials.map((credential) => (
                          <tr key={credential.vm_index} className="border-t border-zinc-800">
                            <td className="px-3 py-2 font-medium text-zinc-400">
                              {credential.vm_index + 1}
                            </td>
                            <td className="px-3 py-2 font-mono text-zinc-200">
                              {credential.ip_address}
                              <CopyButton text={credential.ip_address} />
                            </td>
                            <td className="px-3 py-2 font-mono text-zinc-300">
                              {credential.username}
                            </td>
                            <td className="px-3 py-2 font-mono text-zinc-200">
                              {credential.password}
                              <CopyButton text={credential.password} />
                            </td>
                            <td className="px-3 py-2 text-zinc-500">
                              {new Date(credential.expires_at).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {(isDone || hasFatal) && onClose && (
            <div className="shrink-0 border-t-2 border-zinc-700 p-4">
              <PButton variant="primary" fullWidth customInnerClass="py-2.5" onClick={onClose}>
                {isDone ? 'Go to My VMs' : 'Close'}
              </PButton>
            </div>
          )}
        </PDiv>
      </div>
    </div>
  )
}
