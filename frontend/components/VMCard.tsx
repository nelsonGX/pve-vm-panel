'use client'

import { useEffect, useState } from 'react'

type VMStatus = 'running' | 'provisioning' | 'error' | 'expired'

export interface VM {
  id: string
  name: string
  os: string
  cpu_cores: number
  ram_gb: number
  disk_gb: number
  ip?: string
  status: VMStatus
  expires_at: string
  has_gpu: boolean
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

const STATUS_CLASSES: Record<VMStatus, string> = {
  running: 'bg-green-900 text-green-400',
  provisioning: 'bg-yellow-900 text-yellow-400',
  error: 'bg-red-900 text-red-400',
  expired: 'bg-gray-700 text-gray-400',
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

  const cardOpacity = vm.status === 'expired' ? 'opacity-60' : ''

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-gray-700 bg-gray-800 p-4 ${cardOpacity}`}
    >
      {/* Top row: name + status */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            {getOsLabel(vm.os)}
            {vm.has_gpu && (
              <span className="ml-2 rounded bg-purple-900 px-1.5 py-0.5 text-xs text-purple-300">
                GPU
              </span>
            )}
          </p>
          <h3 className="mt-0.5 font-semibold text-gray-100">{vm.name}</h3>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[vm.status]}`}
        >
          {vm.status}
        </span>
      </div>

      {/* Specs */}
      <div className="flex flex-wrap gap-3 text-sm text-gray-400">
        <span>{vm.cpu_cores} vCPU</span>
        <span>{vm.ram_gb} GB RAM</span>
        <span>{vm.disk_gb} GB Disk</span>
        {vm.ip && <span className="font-mono text-gray-300">{vm.ip}</span>}
      </div>

      {/* Time */}
      <div className="text-sm">
        {isActive ? (
          <span
            className={
              remaining <= 0
                ? 'text-red-400'
                : remaining < 15 * 60 * 1000
                ? 'text-yellow-400'
                : 'text-gray-400'
            }
          >
            {remaining > 0 ? `Expires in ${formatDuration(remaining)}` : 'Expired'}
          </span>
        ) : (
          <span className="text-gray-500">Expired {formatAgo(remaining)}</span>
        )}
      </div>

      {/* Actions */}
      {isActive && onDelete && (
        <button
          onClick={() => onDelete(vm.id)}
          className="mt-1 w-full rounded bg-red-900 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-800 hover:text-red-200"
        >
          Delete VM
        </button>
      )}
    </div>
  )
}
