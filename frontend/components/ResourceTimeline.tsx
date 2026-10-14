'use client'

import { useCallback, useEffect, useReducer, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
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

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
// Candidate tick spacings in minutes; the smallest one giving <= MAX_TICKS is used
const TICK_STEPS_MIN = [15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080]
const MAX_TICKS = 8
const REFRESH_MS = 60_000
const CLOCK_MS = 15_000
const TOOLTIP_W = 224
// Shared column layout so the axis, rows and legend line up exactly
const ROW_GRID = 'grid grid-cols-[11rem_1fr] gap-x-3 px-1 sm:grid-cols-[13rem_1fr]'

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-blue-500',
  provisioning: 'bg-amber-500',
}

function Initials({ name }: { name: string }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-blue-900 text-xs font-bold text-blue-300">
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDay(date: Date): string {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatDate(date: Date, now: number): string {
  if (date.toDateString() === new Date(now).toDateString()) return formatTime(date)
  return formatDay(date) + ' ' + formatTime(date)
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / MINUTE))
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function buildTicks(start: number, end: number): { ticks: Date[]; stepMin: number } {
  const span = end - start
  const stepMin =
    TICK_STEPS_MIN.find((m) => span / (m * MINUTE) <= MAX_TICKS) ??
    Math.ceil(span / MAX_TICKS / DAY) * 1440

  // Align ticks to local midnight so labels land on round times
  const cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() < start) cursor.setMinutes(cursor.getMinutes() + stepMin)

  const ticks: Date[] = []
  while (cursor.getTime() <= end) {
    ticks.push(new Date(cursor))
    cursor.setMinutes(cursor.getMinutes() + stepMin)
  }
  return { ticks, stepMin }
}

function formatTick(date: Date, stepMin: number): string {
  if (stepMin >= 1440 || (date.getHours() === 0 && date.getMinutes() === 0)) return formatDay(date)
  return formatTime(date)
}

function vmStart(vm: TimelineVM, now: number): number {
  return vm.started_at ? Date.parse(vm.started_at) : now
}

interface TooltipState {
  vmId: string
  x: number
  y: number
}

interface TimelineState {
  data: TimelineData | null
  loading: boolean
  error: boolean
  // Server clock minus client clock, so the "now" line matches server time
  clockOffset: number
  now: number
}

type TimelineAction =
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; data: TimelineData; receivedAt: number }
  | { type: 'loadFailed' }
  | { type: 'ticked'; at: number }

function timelineReducer(state: TimelineState, action: TimelineAction): TimelineState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, loading: true }
    case 'loadSucceeded': {
      const serverNow = Date.parse(action.data.now)
      const clockOffset = Number.isNaN(serverNow) ? 0 : serverNow - action.receivedAt
      return {
        data: action.data,
        loading: false,
        error: false,
        clockOffset,
        now: action.receivedAt + clockOffset,
      }
    }
    case 'loadFailed':
      return { ...state, loading: false, error: true }
    case 'ticked':
      return { ...state, now: action.at + state.clockOffset }
  }
}

export default function ResourceTimeline() {
  const [{ data, loading, error, now }, dispatch] = useReducer(
    timelineReducer,
    null,
    (): TimelineState => ({ data: null, loading: true, error: false, clockOffset: 0, now: Date.now() }),
  )
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'loadStarted' })
    try {
      const res = await fetch('/api/v1/resources/timeline', {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: TimelineData = await res.json()
      if (controller.signal.aborted) return
      dispatch({ type: 'loadSucceeded', data: json, receivedAt: Date.now() })
    } catch {
      // Superseded by a newer request or unmounted — let that one own the state
      if (controller.signal.aborted) return
      dispatch({ type: 'loadFailed' })
    }
  }, [])

  useEffect(() => {
    fetchData()
    const refresh = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData()
    }, REFRESH_MS)
    const clock = setInterval(() => dispatch({ type: 'ticked', at: Date.now() }), CLOCK_MS)
    return () => {
      clearInterval(refresh)
      clearInterval(clock)
      abortRef.current?.abort()
    }
  }, [fetchData])

  // The tooltip is pinned to viewport coordinates, so drop it when the page scrolls
  const hasTooltip = tooltip !== null
  useEffect(() => {
    if (!hasTooltip) return
    const hide = () => setTooltip(null)
    window.addEventListener('scroll', hide, { passive: true, capture: true })
    return () => window.removeEventListener('scroll', hide, { capture: true })
  }, [hasTooltip])

  const header = (
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
  )

  if (!data) {
    return (
      <div>
        {header}
        {loading ? (
          <div className="h-24 animate-pulse bg-zinc-800/50" />
        ) : (
          <p className="border border-zinc-800 bg-zinc-900/80 px-5 py-4 text-sm text-zinc-500">
            {error ? 'Could not load the resource timeline.' : 'No active VMs to display.'}
          </p>
        )}
      </div>
    )
  }

  if (data.vms.length === 0) {
    return (
      <div>
        {header}
        <p className="border border-zinc-800 bg-zinc-900/80 px-5 py-4 text-sm text-zinc-600">
          No active VMs to display.
        </p>
      </div>
    )
  }

  const vms = [...data.vms].sort(
    (a, b) => vmStart(a, now) - vmStart(b, now) || Date.parse(a.expires_at) - Date.parse(b.expires_at),
  )

  // Time window: covers every VM plus some context around "now"
  const allMs = vms.flatMap((vm) => [vmStart(vm, now), Date.parse(vm.expires_at)]).filter(Number.isFinite)
  const windowStart = Math.min(...allMs, now - 30 * MINUTE)
  const windowEnd = Math.max(...allMs, now + 60 * MINUTE)
  const windowMs = windowEnd - windowStart

  function pct(t: number): number {
    return ((t - windowStart) / windowMs) * 100
  }

  const { ticks, stepMin } = buildTicks(windowStart, windowEnd)
  const nowPct = pct(now)
  const tooltipVm = tooltip ? vms.find((vm) => vm.id === tooltip.vmId) : undefined

  return (
    <div>
      {header}

      <PDiv fullWidth padding="p-4">
        {/* Time axis */}
        <div className={`${ROW_GRID} mb-2`}>
          <div />
          <div className="relative h-5">
            {ticks.map((tick) => {
              const x = pct(tick.getTime())
              // Keep edge labels inside the track instead of overflowing it
              const align = x < 6 ? 'translate-x-0' : x > 94 ? '-translate-x-full' : '-translate-x-1/2'
              return (
                <span
                  key={tick.getTime()}
                  className={`absolute whitespace-nowrap text-[10px] text-zinc-500 ${align}`}
                  style={{ left: `${x}%` }}
                >
                  {formatTick(tick, stepMin)}
                </span>
              )
            })}
          </div>
        </div>

        {/* VM rows */}
        <div className="flex flex-col gap-2">
          {vms.map((vm) => {
            const startMs = vmStart(vm, now)
            const endMs = Date.parse(vm.expires_at)
            const barLeft = Math.max(0, Math.min(100, pct(startMs)))
            const barRight = Math.max(0, Math.min(100, pct(endMs)))
            const barWidth = Math.max(0, barRight - barLeft)
            const color = STATUS_COLOR[vm.status] ?? 'bg-zinc-500'
            const url = vm.user.avatar_url
            const isHovered = tooltip?.vmId === vm.id
            const trackPointer = (e: MouseEvent) =>
              setTooltip({ vmId: vm.id, x: e.clientX, y: e.clientY })

            return (
              <div
                key={vm.id}
                className={`${ROW_GRID} items-center rounded py-0.5 transition-colors duration-100 ${isHovered ? 'bg-zinc-800/60' : ''}`}
                onMouseEnter={trackPointer}
                onMouseMove={trackPointer}
                onMouseLeave={() => setTooltip(null)}
              >
                {/* Left: user + spec info */}
                <div className="flex min-w-0 items-center gap-2">
                  {url ? (
                    <Image
                      src={url}
                      alt={vm.user.username}
                      width={32}
                      height={32}
                      className={`h-8 w-8 shrink-0 border-2 transition-colors duration-100 ${isHovered ? 'border-zinc-100' : 'border-zinc-300'}`}
                      unoptimized
                      draggable={false}
                    />
                  ) : (
                    <Initials name={vm.user.username} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium transition-colors duration-100 ${isHovered ? 'text-zinc-100' : 'text-zinc-300'}`}>
                      {vm.user.username}
                    </p>
                    <p className="flex items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-zinc-400">
                      <Cpu size={12} className="shrink-0" /><span>{vm.cpu_cores}c</span>
                      <MemoryStick size={12} className="ml-1 shrink-0" /><span>{vm.ram_gb}G</span>
                      <HardDrive size={12} className="ml-1 shrink-0" /><span>{vm.disk_gb}G</span>
                      {vm.has_gpu && <span className="ml-1 text-purple-400">GPU</span>}
                    </p>
                  </div>
                </div>

                {/* Right: timeline bar */}
                <div className="relative h-8 overflow-hidden">
                  {/* Tick grid lines */}
                  {ticks.map((tick) => (
                    <div
                      key={tick.getTime()}
                      className="absolute inset-y-0 w-px bg-zinc-800/70"
                      style={{ left: `${pct(tick.getTime())}%` }}
                    />
                  ))}

                  {/* VM duration bar */}
                  {barWidth > 0 && (
                    <div
                      className={`absolute top-1 bottom-1 ${color} transition-opacity duration-100 ${isHovered ? 'opacity-100' : 'opacity-60'}`}
                      style={{ left: `${barLeft}%`, width: `${barWidth}%`, minWidth: 2 }}
                    />
                  )}

                  {/* Now line */}
                  {nowPct >= 0 && nowPct <= 100 && (
                    <div
                      className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-red-500/80"
                      style={{ left: `${nowPct}%` }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className={`${ROW_GRID} mt-3`}>
          <div />
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-4 bg-blue-500 opacity-75" />
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
            {error && <span className="text-xs text-red-400">Refresh failed — showing last data</span>}
          </div>
        </div>
      </PDiv>

      {/* Portaled to <body>: the PDiv clip-path and the section's transform animation
          would otherwise clip and offset a position:fixed tooltip */}
      {tooltip && tooltipVm && createPortal(
        <TimelineTooltip vm={tooltipVm} x={tooltip.x} y={tooltip.y} now={now} />,
        document.body,
      )}
    </div>
  )
}

function TimelineTooltip({ vm, x, y, now }: { vm: TimelineVM; x: number; y: number; now: number }) {
  const expiresMs = Date.parse(vm.expires_at)
  const remaining = expiresMs - now
  // Flip below the cursor near the top of the viewport and keep it on-screen horizontally
  const below = y < 220
  const left = Math.max(8, Math.min(x + 12, window.innerWidth - TOOLTIP_W - 8))
  const top = below ? y + 16 : y - 12

  return (
    <div
      className={`pointer-events-none fixed z-9999 border border-zinc-700 bg-zinc-900 p-3 text-xs shadow-xl ${below ? '' : '-translate-y-full'}`}
      style={{ left, top, width: TOOLTIP_W }}
    >
      <p className="mb-1 font-semibold text-zinc-100">{vm.user.username}</p>
      <p className="mb-2 text-zinc-400">
        {vm.os} ·{' '}
        <span className={vm.status === 'running' ? 'text-blue-400' : 'text-amber-400'}>
          {vm.status}
        </span>
      </p>
      <div className="space-y-1 text-zinc-400">
        <div className="flex items-center gap-1"><Cpu size={11} /><span>{vm.cpu_cores} cores</span></div>
        <div className="flex items-center gap-1"><MemoryStick size={11} /><span>{vm.ram_gb} GB RAM</span></div>
        <div className="flex items-center gap-1"><HardDrive size={11} /><span>{vm.disk_gb} GB disk</span></div>
        {vm.has_gpu && <p className="text-purple-400">GPU attached</p>}
      </div>
      <div className="mt-2 space-y-1 border-t border-zinc-700 pt-2 text-zinc-400">
        {vm.started_at && <p>Started: <span className="text-zinc-300">{formatDate(new Date(vm.started_at), now)}</span></p>}
        <p>Expires: <span className="text-zinc-300">{formatDate(new Date(expiresMs), now)}</span></p>
        <p>
          {remaining > 0
            ? <>Remaining: <span className="text-zinc-300">{formatDuration(remaining)}</span></>
            : <span className="text-red-400">Expired — shutting down</span>}
        </p>
      </div>
    </div>
  )
}
