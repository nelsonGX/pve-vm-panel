'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import ProvisioningModal, {
  type ProvisioningStep,
  type StepStatus,
  type VMCredentials,
} from '@/components/ProvisioningModal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ResourcesData {
  cpu: { available: number; total: number }
  ram_gb: { available: number; total: number }
  disk_gb: { available: number; total: number }
  gpus: { id: string; available: boolean }[]
}

interface GpuOption {
  id: string
  name: string
  available: boolean
}

interface PricingData {
  price_cpu: number
  price_ram: number
  price_disk: number
  price_gpu: number
}

interface MeData {
  points: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OS_OPTIONS = [
  { id: 'ubuntu-24', label: 'Ubuntu 24', group: 'Ubuntu' },
  { id: 'ubuntu-22', label: 'Ubuntu 22', group: 'Ubuntu' },
  { id: 'ubuntu-20', label: 'Ubuntu 20', group: 'Ubuntu' },
  { id: 'ubuntu-18', label: 'Ubuntu 18', group: 'Ubuntu' },
  { id: 'debian-12', label: 'Debian 12', group: 'Debian' },
  { id: 'debian-11', label: 'Debian 11', group: 'Debian' },
  { id: 'centos-8', label: 'CentOS 8', group: 'CentOS' },
  { id: 'centos-7', label: 'CentOS 7', group: 'CentOS' },
]

const RAM_OPTIONS = [1, 2, 4, 8, 16, 32, 48, 64, 96, 128]
const DURATION_OPTIONS = [
  { label: '1h', hours: 1 },
  { label: '2h', hours: 2 },
  { label: '4h', hours: 4 },
  { label: '8h', hours: 8 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '36h', hours: 36 },
  { label: '48h', hours: 48 },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function computeCost(
  cpuCores: number,
  ramGb: number,
  diskGb: number,
  hasGpu: boolean,
  durationHours: number,
  pricing: PricingData,
): number {
  return Math.ceil(
    (cpuCores * pricing.price_cpu +
      ramGb * pricing.price_ram +
      diskGb * pricing.price_disk +
      (hasGpu ? pricing.price_gpu : 0)) *
      durationHours,
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CreatePage() {
  const { status } = useSession()
  const router = useRouter()

  // Form state
  const [selectedOs, setSelectedOs] = useState<string>('')
  const [cpuCores, setCpuCores] = useState(2)
  const [ramGb, setRamGb] = useState(4)
  const [diskGb, setDiskGb] = useState(50)
  const [hasGpu, setHasGpu] = useState(false)
  const [selectedGpu, setSelectedGpu] = useState<string>('')
  const [durationHours, setDurationHours] = useState(1)

  // Data
  const [resources, setResources] = useState<ResourcesData | null>(null)
  const [pricing, setPricing] = useState<PricingData | null>(null)
  const [me, setMe] = useState<MeData | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // Provisioning modal
  const [modalOpen, setModalOpen] = useState(false)
  const [steps, setSteps] = useState<ProvisioningStep[]>([])
  const [credentials, setCredentials] = useState<VMCredentials | null>(null)
  const [provError, setProvError] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load initial data
  // ---------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    setDataLoading(true)
    setDataError(null)
    try {
      const [res, price, user] = await Promise.all([
        clientApiFetch('/resources'),
        clientApiFetch('/pricing'),
        clientApiFetch('/me'),
      ])
      setResources(res as ResourcesData)
      setPricing(price as PricingData)
      setMe(user as MeData)
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setDataLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') loadData()
  }, [status, loadData])

  // Guard
  if (status === 'loading' || dataLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-indigo-500" />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  if (dataError) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="rounded-xl border border-red-800/60 bg-red-950/30 p-6 text-center">
          <p className="mb-3 text-red-400">{dataError}</p>
          <button
            onClick={loadData}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Computed values
  const maxCpu = resources ? Math.max(1, resources.cpu.available) : 32
  const maxRam = resources ? Math.max(1, resources.ram_gb.available) : 32
  const maxDisk = resources ? Math.min(800, Math.max(10, resources.disk_gb.available)) : 800
  const availableGpus: GpuOption[] = resources?.gpus.filter((g) => g.available).map((g) => ({ id: g.id, name: g.id, available: true })) ?? []
  const gpuAvailable = availableGpus.length > 0

  const cost =
    pricing
      ? computeCost(cpuCores, ramGb, diskGb, hasGpu, durationHours, pricing)
      : null

  const balance = me?.points ?? 0
  const remaining = cost !== null ? balance - cost : null
  const canAfford = remaining === null ? false : remaining >= 0

  const cpuPct = resources ? ((resources.cpu.total - resources.cpu.available) / resources.cpu.total) * 100 : 0
  const ramPct = resources ? ((resources.ram_gb.total - resources.ram_gb.available) / resources.ram_gb.total) * 100 : 0
  const diskPct = resources ? ((resources.disk_gb.total - resources.disk_gb.available) / resources.disk_gb.total) * 100 : 0

  const canCreate =
    !!selectedOs &&
    canAfford &&
    cpuCores <= maxCpu &&
    ramGb <= maxRam &&
    diskGb <= maxDisk &&
    (!hasGpu || !!selectedGpu)

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  async function handleCreate() {
    const initialSteps: ProvisioningStep[] = [
      { key: 'reserve',   label: 'Reserving resources',  status: 'pending' },
      { key: 'clone',     label: 'Cloning template',     status: 'pending' },
      { key: 'storage',   label: 'Configuring storage',  status: 'pending' },
      { key: 'configure', label: 'Configuring VM',       status: 'pending' },
      { key: 'start',     label: 'Starting VM',          status: 'pending' },
    ]
    setSteps(initialSteps)
    setCredentials(null)
    setProvError(null)
    setModalOpen(true)

    const payload = {
      os: selectedOs,
      cpu_cores: cpuCores,
      ram_gb: ramGb,
      disk_gb: diskGb,
      gpu_id: hasGpu ? selectedGpu : undefined,
      duration_hours: durationHours,
    }

    try {
      const response = await fetch('/api/v1/vms/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }))
        throw new Error(err.detail || 'Request failed')
      }

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      outer: while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let event: Record<string, unknown>
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (event.type === 'step') {
            setSteps((prev) =>
              prev.map((s) =>
                s.key === event.step ? { ...s, status: event.status as StepStatus } : s,
              ),
            )
          } else if (event.type === 'complete') {
            setSteps((prev) =>
              prev.map((s) =>
                s.status === 'loading' || s.status === 'pending'
                  ? { ...s, status: 'done' }
                  : s,
              ),
            )
            const d = event.data as Record<string, string>
            setCredentials({
              ip_address: d.ip_address,
              username: d.username,
              password: d.password,
              expires_at: d.expires_at,
            })
            break outer
          } else if (event.type === 'error') {
            throw new Error(event.message as string)
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Provisioning failed'
      setProvError(msg)
      setSteps((prev) =>
        prev.map((s) => (s.status === 'loading' ? { ...s, status: 'error' } : s)),
      )
    }
  }

  function handleModalClose() {
    setModalOpen(false)
    if (credentials) router.push('/vms')
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="animate-fade-in mb-6 text-2xl font-bold text-zinc-100">Create VM</h1>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {/* ---------------------------------------------------------------- */}
          {/* Form                                                              */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex flex-1 flex-col gap-5">

            {/* OS Selection */}
            <section className="animate-fade-in stagger-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Operating System
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {OS_OPTIONS.map((os) => (
                  <button
                    key={os.id}
                    type="button"
                    onClick={() => setSelectedOs(os.id)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-95 ${
                      selectedOs === os.id
                        ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300 shadow-sm shadow-indigo-900/30'
                        : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                    }`}
                  >
                    {os.label}
                  </button>
                ))}
              </div>
            </section>

            {/* CPU */}
            <section className="animate-fade-in stagger-2 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                CPU Cores
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCpuCores((v) => Math.max(1, v - 1))}
                  disabled={cpuCores <= 1}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 transition-all duration-150 hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
                >
                  −
                </button>
                <input
                  type="number"
                  value={cpuCores}
                  min={1}
                  max={maxCpu}
                  onChange={(e) =>
                    setCpuCores(
                      Math.min(maxCpu, Math.max(1, parseInt(e.target.value) || 1)),
                    )
                  }
                  className="w-20 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-center text-sm text-zinc-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => setCpuCores((v) => Math.min(maxCpu, v + 1))}
                  disabled={cpuCores >= maxCpu}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 transition-all duration-150 hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
                >
                  +
                </button>
                <span className="text-sm text-zinc-500">
                  {maxCpu} available
                </span>
              </div>
              {cpuCores > maxCpu * 0.8 && (
                <p className="mt-2 text-xs text-amber-400">High CPU usage on cluster.</p>
              )}
            </section>

            {/* RAM */}
            <section className="animate-fade-in stagger-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                RAM
              </h2>
              <div className="flex flex-wrap gap-2">
                {RAM_OPTIONS.map((gb) => (
                  <button
                    key={gb}
                    type="button"
                    onClick={() => setRamGb(gb)}
                    disabled={gb > maxRam}
                    className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                      ramGb === gb
                        ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300 shadow-sm shadow-indigo-900/30'
                        : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                    }`}
                  >
                    {gb} GB
                  </button>
                ))}
              </div>
            </section>

            {/* Disk */}
            <section className="animate-fade-in stagger-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Disk
                </h2>
                <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-sm font-medium text-zinc-200">
                  {diskGb} GB
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={maxDisk}
                step={10}
                value={diskGb}
                onChange={(e) => setDiskGb(parseInt(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="mt-1.5 flex justify-between text-xs text-zinc-600">
                <span>10 GB</span>
                <span>{maxDisk} GB</span>
              </div>
            </section>

            {/* GPU */}
            <section className="animate-fade-in stagger-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  GPU
                </h2>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hasGpu}
                  onClick={() => {
                    if (!gpuAvailable) return
                    setHasGpu((v) => !v)
                    if (hasGpu) setSelectedGpu('')
                  }}
                  disabled={!gpuAvailable}
                  className={`relative h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
                    hasGpu ? 'bg-indigo-600' : 'bg-zinc-700'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      hasGpu ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {!gpuAvailable && (
                <p className="text-xs text-zinc-600">No GPUs available.</p>
              )}
              {hasGpu && availableGpus.length > 0 && (
                <select
                  value={selectedGpu}
                  onChange={(e) => setSelectedGpu(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                >
                  <option value="">Select GPU...</option>
                  {availableGpus.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </section>

            {/* Duration */}
            <section className="animate-fade-in stagger-4 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Duration
              </h2>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d.hours}
                    type="button"
                    onClick={() => setDurationHours(d.hours)}
                    className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-all duration-150 active:scale-95 ${
                      durationHours === d.hours
                        ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300 shadow-sm shadow-indigo-900/30'
                        : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Cost Sidebar                                                      */}
          {/* ---------------------------------------------------------------- */}
          <div className="w-full lg:w-72 lg:shrink-0">
            <div className="animate-fade-in stagger-2 sticky top-20 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Cost Summary
              </h2>

              <dl className="flex flex-col gap-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Required</dt>
                  <dd className="font-semibold text-zinc-100">
                    {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Your balance</dt>
                  <dd className="font-semibold text-zinc-100">
                    {balance.toLocaleString()} pts
                  </dd>
                </div>
                <div className="my-1 border-t border-zinc-800" />
                <div className="flex justify-between">
                  <dt className="text-zinc-500">After purchase</dt>
                  <dd
                    className={`font-bold ${
                      remaining === null
                        ? 'text-zinc-500'
                        : remaining < 0
                        ? 'text-red-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {remaining !== null
                      ? `${remaining.toLocaleString()} pts`
                      : '—'}
                  </dd>
                </div>
              </dl>

              {/* Warnings */}
              <div className="mt-3 flex flex-col gap-1">
                {cpuPct >= 80 && (
                  <p className="text-xs text-amber-400">Warning: CPU at {cpuPct.toFixed(0)}%</p>
                )}
                {ramPct >= 80 && (
                  <p className="text-xs text-amber-400">Warning: RAM at {ramPct.toFixed(0)}%</p>
                )}
                {diskPct >= 80 && (
                  <p className="text-xs text-amber-400">Warning: Disk at {diskPct.toFixed(0)}%</p>
                )}
                {!selectedOs && (
                  <p className="text-xs text-zinc-600">Select an OS to continue.</p>
                )}
                {!canAfford && cost !== null && (
                  <p className="text-xs text-red-400">Insufficient points.</p>
                )}
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreate}
                className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create VM
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile cost bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span className="text-zinc-500">Cost: </span>
            <span className="font-bold text-zinc-100">
              {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create VM
          </button>
        </div>
      </div>

      <ProvisioningModal
        open={modalOpen}
        steps={steps}
        credentials={credentials}
        error={provError}
        onClose={handleModalClose}
      />
    </>
  )
}
