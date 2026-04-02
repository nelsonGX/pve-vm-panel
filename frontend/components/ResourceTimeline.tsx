'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import { Cpu, MemoryStick, HardDrive } from 'lucide-react'

interface TimelineUser {
  username: string
  avatar_url: string | null
}

interface TimelineVM {
  id: string
  user: TimelineUser
  os: string
  cpu_cores: number
  ram_gb: number
  disk_gb: number
  has_gpu: boolean
  started_at: string | null
  expires_at: string
  status: 'running' | 'provisioning'
}

interface TimelineData {
  vms: TimelineVM[]
  now: string
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-indigo-500',
  provisioning: 'bg-amber-500',
}

function Initials({ name }: { name: string }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-indigo-900 text-xs font-bold text-indigo-300">
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(date: Date): string {
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return formatTime(date)
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + formatTime(date)
}

export default function ResourceTimeline() {
  const [data, setData] = useState<TimelineData | null>(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => new Date())

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/resources/timeline')
      if (res.ok) {
        const json: TimelineData = await res.json()
        setData(json)
        setNow(new Date(json.now))
      }
    } catch {
      // silently ignore — non-critical widget
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    const tick = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(tick)
  }, [])

  if (loading) {
    return (
      <div className="h-24 animate-pulse bg-zinc-800/50" />
    )
  }

  if (!data || data.vms.length === 0) {
    return (
      <p className="border border-zinc-800 bg-zinc-900/80 px-5 py-4 text-sm text-zinc-600">
        No active VMs to display.
      </p>
    )
  }

  // Build time window
  const allMs = data.vms.flatMap((vm) => [
    vm.started_at ? new Date(vm.started_at).getTime() : now.getTime(),
    new Date(vm.expires_at).getTime(),
  ])
  const windowStart = new Date(Math.min(...allMs, now.getTime() - 30 * 60_000))
  const windowEnd   = new Date(Math.max(...allMs, now.getTime() + 60 * 60_000))
  const windowMs    = windowEnd.getTime() - windowStart.getTime()

  function pct(t: number): number {
    return ((t - windowStart.getTime()) / windowMs) * 100
  }

  // Hourly tick marks
  const ticks: Date[] = []
  const cursor = new Date(windowStart)
  cursor.setMinutes(0, 0, 0)
  cursor.setHours(cursor.getHours() + 1)
  while (cursor <= windowEnd) {
    ticks.push(new Date(cursor))
    cursor.setHours(cursor.getHours() + 1)
  }

  const nowPct = pct(now.getTime())

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-md font-semibold uppercase tracking-widest text-zinc-500">
          Resource Timeline
        </h2>
        <PButton
          variant="secondary"
          onClick={fetchData}
          customInnerClass="px-3 py-1 text-xs"
        >
          Refresh
        </PButton>
      </div>

      <PDiv fullWidth padding="p-4">
        {/* Time axis */}
        <div className="relative mb-2 ml-48 h-5">
          {ticks.map((tick, i) => {
            const x = pct(tick.getTime())
            if (x < 0 || x > 100) return null
            return (
              <span
                key={i}
                className="absolute -translate-x-1/2 text-[10px] text-zinc-600"
                style={{ left: `${x}%` }}
              >
                {formatTime(tick)}
              </span>
            )
          })}
        </div>

        {/* VM rows */}
        <div className="flex flex-col gap-2">
          {data.vms.map((vm) => {
            const startMs = vm.started_at ? new Date(vm.started_at).getTime() : now.getTime()
            const endMs   = new Date(vm.expires_at).getTime()
            const barLeft  = Math.max(0, Math.min(100, pct(startMs)))
            const barRight = Math.max(0, Math.min(100, pct(endMs)))
            const barWidth = barRight - barLeft
            const color    = STATUS_COLOR[vm.status] ?? 'bg-zinc-500'
            const url      = vm.user.avatar_url
            const expires  = new Date(vm.expires_at)

            return (
              <div key={vm.id} className="flex items-center gap-3">
                {/* Left: user + spec info */}
                <div className="flex w-48 shrink-0 items-center gap-2 overflow-hidden">
                  {url ? (
                    <Image
                      src={url}
                      alt={vm.user.username}
                      width={32}
                      height={32}
                      className="border-2 border-zinc-300"
                      unoptimized
                      draggable={false}
                    />
                  ) : (
                    <Initials name={vm.user.username} />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-md font-medium text-zinc-300">
                      {vm.user.username}
                    </p>
                    <p className="truncate text-sm text-zinc-400 flex items-center space-x-1">
                      <Cpu size={14} /><span>{vm.cpu_cores}c / </span><MemoryStick size={14} /><span>{vm.ram_gb}GB / </span><HardDrive size={14} /><span>{vm.disk_gb}GB</span>
                      {vm.has_gpu && ' · GPU'}
                    </p>
                  </div>
                </div>

                {/* Right: timeline bar */}
                <div className="relative h-8 flex-1 overflow-hidden">
                  {/* Tick grid lines */}
                  {ticks.map((tick, i) => {
                    const x = pct(tick.getTime())
                    if (x < 0 || x > 100) return null
                    return (
                      <div
                        key={i}
                        className="absolute inset-y-0 w-px bg-zinc-800/70"
                        style={{ left: `${x}%` }}
                      />
                    )
                  })}

                  {/* Now line */}
                  {nowPct >= 0 && nowPct <= 100 && (
                    <div
                      className="absolute inset-y-0 z-10 w-0.5 bg-red-500/80"
                      style={{ left: `${nowPct}%` }}
                    />
                  )}

                  {/* VM duration bar */}
                  {barWidth > 0 && (
                    <div
                      className={`absolute top-1.5 bottom-1.5 ${color} opacity-75 transition-all`}
                      style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
                      title={`${vm.user.username} — expires ${formatDate(expires)}`}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="mt-3 ml-48 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-4 bg-indigo-500 opacity-75" />
            <span className="text-xs text-zinc-300">Running</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-4 bg-amber-500 opacity-75" />
            <span className="text-xs text-zinc-300">Provisioning</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-3.5 w-0.5 bg-red-500/80" />
            <span className="text-xs text-zinc-300">Now</span>
          </div>
        </div>
      </PDiv>
    </div>
  )
}
