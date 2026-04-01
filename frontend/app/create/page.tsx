'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import ProvisioningModal, {
  type ProvisioningStep,
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
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-600 border-t-indigo-500" />
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
        <div className="rounded-lg border border-red-800 bg-red-900/30 p-6 text-center">
          <p className="mb-3 text-red-400">{dataError}</p>
          <button
            onClick={loadData}
            className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
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
      { label: 'Reserving resources', status: 'loading' },
      { label: 'Creating VM disk', status: 'pending' },
      { label: 'Configuring network', status: 'pending' },
      { label: 'Starting VM', status: 'pending' },
      { label: 'Waiting for cloud-init', status: 'pending' },
    ]
    setSteps(initialSteps)
    setCredentials(null)
    setProvError(null)
    setModalOpen(true)

    try {
      // Step 1 done, step 2 loading
      await new Promise((r) => setTimeout(r, 600))
      setSteps((prev) =>
        prev.map((s, i) =>
          i === 0 ? { ...s, status: 'done' } : i === 1 ? { ...s, status: 'loading' } : s,
        ),
      )

      const payload = {
        os: selectedOs,
        cpu_cores: cpuCores,
        ram_gb: ramGb,
        disk_gb: diskGb,
        has_gpu: hasGpu,
        gpu_id: hasGpu ? selectedGpu : undefined,
        duration_hours: durationHours,
      }

      const data = await clientApiFetch('/vms', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      // Simulate steps completing
      for (let i = 1; i < initialSteps.length; i++) {
        await new Promise((r) => setTimeout(r, 700))
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: 'done' }
              : idx === i + 1
              ? { ...s, status: 'loading' }
              : s,
          ),
        )
      }

      setCredentials({
        ip: data.ip,
        username: data.username,
        password: data.password,
        expires_at: data.expires_at,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Provisioning failed'
      setProvError(msg)
      setSteps((prev) =>
        prev.map((s) =>
          s.status === 'loading' ? { ...s, status: 'error' } : s,
        ),
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
        <h1 className="mb-6 text-2xl font-bold text-gray-100">Create VM</h1>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          {/* ---------------------------------------------------------------- */}
          {/* Form                                                              */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex flex-1 flex-col gap-6">

            {/* OS Selection */}
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                Operating System
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {OS_OPTIONS.map((os) => (
                  <button
                    key={os.id}
                    type="button"
                    onClick={() => setSelectedOs(os.id)}
                    className={`rounded border px-3 py-2 text-sm font-medium transition-colors ${
                      selectedOs === os.id
                        ? 'border-indigo-500 bg-indigo-900/50 text-indigo-300'
                        : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    {os.label}
                  </button>
                ))}
              </div>
            </section>

            {/* CPU */}
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                CPU Cores
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCpuCores((v) => Math.max(1, v - 1))}
                  disabled={cpuCores <= 1}
                  className="flex h-9 w-9 items-center justify-center rounded border border-gray-700 bg-gray-800 text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-40"
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
                  className="w-20 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-center text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setCpuCores((v) => Math.min(maxCpu, v + 1))}
                  disabled={cpuCores >= maxCpu}
                  className="flex h-9 w-9 items-center justify-center rounded border border-gray-700 bg-gray-800 text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-40"
                >
                  +
                </button>
                <span className="text-sm text-gray-500">
                  {maxCpu} available
                </span>
              </div>
              {cpuCores > maxCpu * 0.8 && (
                <p className="mt-2 text-xs text-yellow-400">High CPU usage on cluster.</p>
              )}
            </section>

            {/* RAM */}
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                RAM
              </h2>
              <div className="flex flex-wrap gap-2">
                {RAM_OPTIONS.map((gb) => (
                  <button
                    key={gb}
                    type="button"
                    onClick={() => setRamGb(gb)}
                    disabled={gb > maxRam}
                    className={`rounded border px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      ramGb === gb
                        ? 'border-indigo-500 bg-indigo-900/50 text-indigo-300'
                        : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-700'
                    }`}
                  >
                    {gb} GB
                  </button>
                ))}
              </div>
            </section>

            {/* Disk */}
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Disk
                </h2>
                <span className="text-sm font-medium text-gray-200">{diskGb} GB</span>
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
              <div className="mt-1 flex justify-between text-xs text-gray-500">
                <span>10 GB</span>
                <span>{maxDisk} GB</span>
              </div>
            </section>

            {/* GPU */}
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
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
                  className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
                    hasGpu ? 'bg-indigo-600' : 'bg-gray-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                      hasGpu ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {!gpuAvailable && (
                <p className="text-xs text-gray-500">No GPUs available.</p>
              )}
              {hasGpu && availableGpus.length > 0 && (
                <select
                  value={selectedGpu}
                  onChange={(e) => setSelectedGpu(e.target.value)}
                  className="mt-2 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-indigo-500 focus:outline-none"
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
            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
                Duration
              </h2>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d.hours}
                    type="button"
                    onClick={() => setDurationHours(d.hours)}
                    className={`rounded border px-4 py-1.5 text-sm font-medium transition-colors ${
                      durationHours === d.hours
                        ? 'border-indigo-500 bg-indigo-900/50 text-indigo-300'
                        : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-600 hover:bg-gray-700'
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
            <div className="sticky top-20 rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
                Cost Summary
              </h2>

              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-400">Required</dt>
                  <dd className="font-semibold text-gray-100">
                    {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-400">Your balance</dt>
                  <dd className="font-semibold text-gray-100">
                    {balance.toLocaleString()} pts
                  </dd>
                </div>
                <div className="my-1 border-t border-gray-800" />
                <div className="flex justify-between">
                  <dt className="text-gray-400">After purchase</dt>
                  <dd
                    className={`font-bold ${
                      remaining === null
                        ? 'text-gray-400'
                        : remaining < 0
                        ? 'text-red-400'
                        : 'text-green-400'
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
                  <p className="text-xs text-yellow-400">Warning: CPU at {cpuPct.toFixed(0)}%</p>
                )}
                {ramPct >= 80 && (
                  <p className="text-xs text-yellow-400">Warning: RAM at {ramPct.toFixed(0)}%</p>
                )}
                {diskPct >= 80 && (
                  <p className="text-xs text-yellow-400">Warning: Disk at {diskPct.toFixed(0)}%</p>
                )}
                {!selectedOs && (
                  <p className="text-xs text-gray-500">Select an OS to continue.</p>
                )}
                {!canAfford && cost !== null && (
                  <p className="text-xs text-red-400">Insufficient points.</p>
                )}
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={!canCreate}
                className="mt-4 w-full rounded bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create VM
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile cost bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-gray-800 bg-gray-900 px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span className="text-gray-400">Cost: </span>
            <span className="font-bold text-gray-100">
              {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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
