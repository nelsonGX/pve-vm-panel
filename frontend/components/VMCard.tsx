'use client'

import { useEffect, useState } from 'react'

type VMStatus = 'running' | 'provisioning' | 'error' | 'expired'

export interface VM {
  id: string
  vmid: number
  name: string
  os: string
  cpu_cores: number
  ram_gb: number
  disk_gb: number
  ip?: string
  status: VMStatus
  expires_at: string
  has_gpu: boolean
  bulk_id?: string
}

interface VMCardProps {
  vm: VM
  onDelete?: (id: string) => void
}

const OS_ICONS: Record<string, string> = {
  ubuntu: 'Ubuntu',
  centos: 'CentOS',
  debian: 'Debian',
}

const STATUS_STYLES: Record<VMStatus, { badge: string; dot: string }> = {
  running: {
    badge: 'border-emerald-800/60 bg-emerald-950/60 text-emerald-400',
    dot: 'bg-emerald-400 animate-pulse',
  },
  provisioning: {
    badge: 'border-amber-800/60 bg-amber-950/60 text-amber-400',
    dot: 'bg-amber-400 animate-pulse',
  },
  error: {
    badge: 'border-red-800/60 bg-red-950/60 text-red-400',
    dot: 'bg-red-400',
  },
  expired: {
    badge: 'border-zinc-700/60 bg-zinc-800/60 text-zinc-500',
    dot: 'bg-zinc-600',
  },
}

function formatDuration(ms: number): string {
  if (ms <= 0) return 'Expired'
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatAgo(ms: number): string {
  const totalSecs = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m ago`
  if (m > 0) return `${m}m ago`
  return `${totalSecs}s ago`
}

function getOsLabel(os: string): string {
  const lower = os.toLowerCase()
  for (const [key, label] of Object.entries(OS_ICONS)) {
    if (lower.includes(key)) return label
  }
  return os
}

export default function VMCard({ vm, onDelete }: VMCardProps) {
  const expiresAt = new Date(vm.expires_at).getTime()
  const [remaining, setRemaining] = useState<number>(() => expiresAt - Date.now())
  const isActive = vm.status === 'running' || vm.status === 'provisioning'

  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => {
      setRemaining(expiresAt - Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, isActive])

  const statusStyle = STATUS_STYLES[vm.status]

  return (
    <div
      className={`group flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm transition-all duration-200 hover:border-zinc-700 hover:shadow-md ${
        vm.status === 'expired' ? 'opacity-55' : ''
      }`}
    >
      {/* Top row: name + status */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            {getOsLabel(vm.os)}
            {vm.has_gpu && (
              <span className="ml-2 rounded-md border border-purple-800/50 bg-purple-950/50 px-1.5 py-0.5 text-xs text-purple-300">
                GPU
              </span>
            )}
          </p>
          <h3 className="mt-0.5 font-semibold text-zinc-100">{vm.name}</h3>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${statusStyle.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
          {vm.status}
        </span>
      </div>

      {/* Specs */}
      <div className="flex flex-wrap gap-2">
        {[
          `${vm.cpu_cores} vCPU`,
          `${vm.ram_gb} GB RAM`,
          `${vm.disk_gb} GB Disk`,
        ].map((spec) => (
          <span
            key={spec}
            className="rounded-md border border-zinc-800 bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-400"
          >
            {spec}
          </span>
        ))}
        {vm.ip && (
          <span className="rounded-md border border-zinc-800 bg-zinc-800/60 px-2 py-0.5 font-mono text-xs text-zinc-300">
            {vm.ip}
          </span>
        )}
      </div>

      {/* Time */}
      <div className="text-sm">
        {isActive ? (
          <span
            className={`font-medium ${
              remaining <= 0
                ? 'text-red-400'
                : remaining < 15 * 60 * 1000
                ? 'text-amber-400'
                : 'text-zinc-400'
            }`}
          >
            {remaining > 0 ? `Expires in ${formatDuration(remaining)}` : 'Expired'}
          </span>
        ) : (
          <span className="text-zinc-600">Expired {formatAgo(remaining)}</span>
        )}
      </div>

      {/* Actions */}
      {isActive && onDelete && (
        <button
          onClick={() => onDelete(vm.id)}
          className="mt-auto w-full rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-sm font-medium text-red-400 transition-all duration-150 hover:border-red-800 hover:bg-red-900/50 hover:text-red-300 active:scale-[0.98]"
        >
          Delete VM
        </button>
      )}
    </div>
  )
}
