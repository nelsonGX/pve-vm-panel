'use client'

import { useEffect, useRef, useState } from 'react'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import Icon from '@/components/baseui/icon'

type VMStatus = 'running' | 'stopped' | 'provisioning' | 'error' | 'expired'

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
  onStart?: (id: string) => void
  onStop?: (id: string) => void
  onRestart?: (id: string) => void
  loadingAction?: 'start' | 'stop' | 'restart' | 'delete' | null
}

const OS_ICONS: Record<string, string> = {
  ubuntu: 'Ubuntu',
  centos: 'CentOS',
  debian: 'Debian',
}

const STATUS_STYLES: Record<VMStatus, { badge: string; dot: string }> = {
  running: {
    badge: 'border-emerald-700 bg-emerald-950 text-emerald-400',
    dot: 'bg-emerald-400 animate-pulse',
  },
  provisioning: {
    badge: 'border-amber-700 bg-amber-950 text-amber-400',
    dot: 'bg-amber-400 animate-pulse',
  },
  stopped: {
    badge: 'border-sky-700 bg-sky-950 text-sky-300',
    dot: 'bg-sky-300',
  },
  error: {
    badge: 'border-red-700 bg-red-950 text-red-400',
    dot: 'bg-red-400',
  },
  expired: {
    badge: 'border-zinc-700 bg-zinc-800 text-zinc-500',
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
  if (lower.includes('ubuntu')) return OS_ICONS.ubuntu
  if (lower.includes('centos')) return OS_ICONS.centos
  if (lower.includes('debian')) return OS_ICONS.debian
  return os
}

export default function VMCard({ vm, onDelete, onStart, onStop, onRestart, loadingAction = null }: VMCardProps) {
  const expiresAt = new Date(vm.expires_at).getTime()
  const [remaining, setRemaining] = useState<number>(() => expiresAt - Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isActive = vm.status === 'running' || vm.status === 'provisioning'
  const isStopped = vm.status === 'stopped'

  useEffect(() => {
    if (!isActive) return
    const id = setInterval(() => {
      setRemaining(expiresAt - Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [expiresAt, isActive])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

  const statusStyle = STATUS_STYLES[vm.status]
  const canManage = isActive || isStopped
  const menuActions = [
    isStopped && onStart ? { key: 'start' as const, label: 'Start VM', onClick: () => onStart(vm.id) } : null,
    vm.status === 'running' && onStop ? { key: 'stop' as const, label: 'Stop VM', onClick: () => onStop(vm.id) } : null,
    vm.status === 'running' && onRestart ? { key: 'restart' as const, label: 'Restart VM', onClick: () => onRestart(vm.id) } : null,
    onDelete ? { key: 'delete' as const, label: 'Delete VM', onClick: () => onDelete(vm.id), danger: true } : null,
  ].filter(Boolean)

  return (
    <PDiv fullWidth padding="p-4" className={vm.status === 'expired' ? 'opacity-55' : ''}>
      <div className="flex flex-col gap-4">
        {/* Top row: name + status */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {getOsLabel(vm.os)}
              {vm.has_gpu && (
                <span className="ml-2 border border-purple-700 bg-purple-950 px-1.5 py-0.5 text-xs text-purple-300">
                  GPU
                </span>
              )}
            </p>
            <h3 className="mt-0.5 font-semibold text-zinc-100">{vm.name}</h3>
          </div>
          <span className={`flex shrink-0 items-center gap-1.5 border px-2 py-0.5 text-xs font-medium ${statusStyle.badge}`}>
            <span className={`h-1.5 w-1.5 ${statusStyle.dot}`} />
            {vm.status}
          </span>
        </div>

        {/* Specs */}
        <div className="flex flex-wrap gap-2">
          {[`${vm.cpu_cores} vCPU`, `${vm.ram_gb} GB RAM`, `${vm.disk_gb} GB Disk`].map((spec) => (
            <span key={spec} className="border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {spec}
            </span>
          ))}
          {vm.ip && (
            <span className="border border-zinc-700 bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
              {vm.ip}
            </span>
          )}
        </div>

        {/* Time */}
        <div className="text-sm">
          {isActive ? (
            <span className={`font-medium ${
              remaining <= 0 ? 'text-red-400' : remaining < 15 * 60 * 1000 ? 'text-amber-400' : 'text-zinc-400'
            }`}>
              {remaining > 0 ? `Expires in ${formatDuration(remaining)}` : 'Expired'}
            </span>
          ) : (
            <span className="text-zinc-600">Expired {formatAgo(remaining)}</span>
          )}
        </div>

        {/* Actions */}
        {canManage && menuActions.length > 0 && (
          <div className="relative" ref={menuRef}>
            <PButton
              variant="gray"
              fullWidth
              customInnerClass="py-1.5"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="mr-1">Options</span>
              <Icon name={menuOpen ? 'dropup' : 'dropdown'} size={12} color="#d4d4d8" />
            </PButton>
            {menuOpen && (
              <div className="mt-2 w-full border-4 border-zinc-700 bg-zinc-950">
                <div className="flex flex-col">
                  {menuActions.map((action) => action && (
                    <button
                      key={action.key}
                      type="button"
                      className={`border-b border-zinc-800 px-4 py-2 text-left text-sm transition-colors last:border-b-0 ${
                        action.danger
                          ? 'text-red-300 hover:bg-red-950/40'
                          : 'text-zinc-200 hover:bg-zinc-900'
                      } ${loadingAction ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
                      disabled={loadingAction !== null}
                      onClick={() => {
                        setMenuOpen(false)
                        action.onClick()
                      }}
                    >
                      <span className={loadingAction === action.key ? 'opacity-100' : ''}>
                        {loadingAction === action.key ? `${action.label}...` : action.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </PDiv>
  )
}
