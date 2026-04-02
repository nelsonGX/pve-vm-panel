'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  Minus,
  Plus,
} from 'lucide-react'
import { clientApiFetch } from '@/lib/api'
import ProvisioningModal, {
  type ProvisioningStep,
  type StepStatus,
  type VMCredentials,
} from '@/components/ProvisioningModal'
import BulkProvisioningModal, {
  type PrepStep,
  type BulkVMStatus,
  type BulkCredential,
} from '@/components/BulkProvisioningModal'
import type { VM } from '@/components/VMCard'

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

const PREP_STEP_LABELS: Record<string, string> = {
  stop_source: 'Stopping source VM',
  clone_template: 'Cloning to template',
  convert_template: 'Converting to template',
  start_source: 'Restarting source VM',
}

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
// Step definitions
// ---------------------------------------------------------------------------
type StepKey = 'os' | 'cpu' | 'ram' | 'disk' | 'gpu' | 'duration' | 'count_password' | 'review'

interface WizardStep {
  key: StepKey
  label: string
}

const NORMAL_STEPS: WizardStep[] = [
  { key: 'os',       label: 'OS' },
  { key: 'cpu',      label: 'CPU' },
  { key: 'ram',      label: 'RAM' },
  { key: 'disk',     label: 'Disk' },
  { key: 'gpu',      label: 'GPU' },
  { key: 'duration', label: 'Duration' },
  { key: 'review',   label: 'Review' },
]

const BULK_STEPS: WizardStep[] = [
  { key: 'os',             label: 'OS' },
  { key: 'cpu',            label: 'CPU' },
  { key: 'ram',            label: 'RAM' },
  { key: 'disk',           label: 'Disk' },
  { key: 'duration',       label: 'Duration' },
  { key: 'count_password', label: 'Batch' },
  { key: 'review',         label: 'Review' },
]

// ---------------------------------------------------------------------------
// Inner page component (uses useSearchParams)
// ---------------------------------------------------------------------------
function CreatePageContent() {
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isBulk = searchParams.has('bulk')

  // Form state
  const [selectedOs, setSelectedOs] = useState<string>('')
  const [cpuCores, setCpuCores] = useState(16)
  const [ramGb, setRamGb] = useState(32)
  const [diskGb, setDiskGb] = useState(50)
  const [hasGpu, setHasGpu] = useState(false)
  const [selectedGpu, setSelectedGpu] = useState<string>('')
  const [durationHours, setDurationHours] = useState(1)

  // Bulk-specific form state
  const [vmCount, setVmCount] = useState(5)
  const [passwordMode, setPasswordMode] = useState<'random' | 'unified'>('random')
  const [unifiedPassword, setUnifiedPassword] = useState('')
  const [selectedSourceVmid, setSelectedSourceVmid] = useState<number | null>(null)
  const [userVms, setUserVms] = useState<VM[]>([])

  // Wizard step
  const [stepIndex, setStepIndex] = useState(0)

  // Data
  const [resources, setResources] = useState<ResourcesData | null>(null)
  const [pricing, setPricing] = useState<PricingData | null>(null)
  const [me, setMe] = useState<MeData | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

  // Single VM provisioning modal
  const [modalOpen, setModalOpen] = useState(false)
  const [steps, setSteps] = useState<ProvisioningStep[]>([])
  const [credentials, setCredentials] = useState<VMCredentials | null>(null)
  const [provError, setProvError] = useState<string | null>(null)

  // Bulk provisioning modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkPrepSteps, setBulkPrepSteps] = useState<PrepStep[]>([])
  const [bulkVmStatuses, setBulkVmStatuses] = useState<BulkVMStatus[]>([])
  const [bulkCredentials, setBulkCredentials] = useState<BulkCredential[]>([])
  const [bulkErrors, setBulkErrors] = useState<{ vm_index: number; message: string }[]>([])
  const [bulkFatalError, setBulkFatalError] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load initial data
  // ---------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    setDataLoading(true)
    setDataError(null)
    try {
      const baseRequests = [
        clientApiFetch('/resources'),
        clientApiFetch('/pricing'),
        clientApiFetch('/me'),
      ] as const
      if (isBulk) {
        const [res, price, user, vms] = await Promise.all([
          ...baseRequests,
          clientApiFetch('/vms'),
        ])
        setResources(res as ResourcesData)
        setPricing(price as PricingData)
        setMe(user as MeData)
        setUserVms(
          ((vms as VM[]) ?? []).filter((v) => v.status === 'running'),
        )
      } else {
        const [res, price, user] = await Promise.all(baseRequests)
        setResources(res as ResourcesData)
        setPricing(price as PricingData)
        setMe(user as MeData)
      }
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setDataLoading(false)
    }
  }, [isBulk])

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
  const availableGpus: GpuOption[] =
    resources?.gpus.filter((g) => g.available).map((g) => ({ id: g.id, name: g.id, available: true })) ?? []
  const gpuAvailable = availableGpus.length > 0

  const singleCost = pricing
    ? computeCost(cpuCores, ramGb, diskGb, isBulk ? false : hasGpu, durationHours, pricing)
    : null
  const cost = isBulk && singleCost !== null ? singleCost * vmCount : singleCost

  const balance = me?.points ?? 0
  const remaining = cost !== null ? balance - cost : null
  const canAfford = remaining === null ? false : remaining >= 0

  const cpuPct = resources ? ((resources.cpu.total - resources.cpu.available) / resources.cpu.total) * 100 : 0
  const ramPct = resources ? ((resources.ram_gb.total - resources.ram_gb.available) / resources.ram_gb.total) * 100 : 0
  const diskPct = resources ? ((resources.disk_gb.total - resources.disk_gb.available) / resources.disk_gb.total) * 100 : 0

  // Build visible steps
  const baseSteps = isBulk ? BULK_STEPS : NORMAL_STEPS
  const visibleSteps = baseSteps.filter((s) => s.key !== 'gpu' || gpuAvailable)
  const currentStep = visibleSteps[stepIndex]

  // Total resources needed (only meaningful once vmCount is set, used in count_password + review)
  const totalCpuNeeded  = cpuCores * vmCount
  const totalRamNeeded  = ramGb    * vmCount
  const totalDiskNeeded = diskGb   * vmCount

  const cpuFits  = resources ? totalCpuNeeded  <= resources.cpu.available     : true
  const ramFits  = resources ? totalRamNeeded  <= resources.ram_gb.available  : true
  const diskFits = resources ? totalDiskNeeded <= resources.disk_gb.available : true

  // Per-step "next" validity
  const stepValid: Record<StepKey, boolean> = {
    os:             !!selectedOs,
    cpu:            cpuCores >= 1 && cpuCores <= maxCpu,
    ram:            ramGb >= 1 && ramGb <= maxRam,
    disk:           diskGb >= 10 && diskGb <= maxDisk,
    gpu:            !hasGpu || !!selectedGpu,
    duration:       true,
    count_password: vmCount >= 1 && vmCount <= 50
                    && (passwordMode !== 'unified' || unifiedPassword.length >= 8)
                    && (!isBulk || (cpuFits && ramFits && diskFits)),
    review:         !!selectedOs && canAfford && (!isBulk || (cpuFits && ramFits && diskFits)) && (isBulk || !hasGpu || !!selectedGpu),
  }

  const canNext = stepValid[currentStep.key]

  function goNext() {
    if (stepIndex < visibleSteps.length - 1) setStepIndex((i) => i + 1)
  }
  function goBack() {
    if (stepIndex > 0) setStepIndex((i) => i - 1)
  }

  // ---------------------------------------------------------------------------
  // Single VM submit
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
                s.status === 'loading' || s.status === 'pending' ? { ...s, status: 'done' } : s,
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

  // ---------------------------------------------------------------------------
  // Bulk VM submit
  // ---------------------------------------------------------------------------
  async function handleBulkCreate() {
    const hasPrepSteps = selectedSourceVmid !== null
    const initialPrepSteps: PrepStep[] = hasPrepSteps
      ? [
          { key: 'stop_source',      label: PREP_STEP_LABELS.stop_source,      status: 'pending' },
          { key: 'clone_template',   label: PREP_STEP_LABELS.clone_template,   status: 'pending' },
          { key: 'convert_template', label: PREP_STEP_LABELS.convert_template, status: 'pending' },
          { key: 'start_source',     label: PREP_STEP_LABELS.start_source,     status: 'pending' },
        ]
      : []

    setBulkPrepSteps(initialPrepSteps)
    setBulkVmStatuses(Array.from({ length: vmCount }, () => ({ currentStep: 'waiting', status: 'pending' as StepStatus })))
    setBulkCredentials([])
    setBulkErrors([])
    setBulkFatalError(null)
    setBulkModalOpen(true)

    const payload = {
      os: selectedOs,
      cpu_cores: cpuCores,
      ram_gb: ramGb,
      disk_gb: diskGb,
      duration_hours: durationHours,
      count: vmCount,
      password_mode: passwordMode,
      unified_password: passwordMode === 'unified' ? unifiedPassword : undefined,
      source_vmid: selectedSourceVmid,
    }

    try {
      const response = await fetch('/api/v1/vms/bulk/stream', {
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

          if (event.type === 'prep_step') {
            setBulkPrepSteps((prev) =>
              prev.map((s) =>
                s.key === event.step ? { ...s, status: event.status as StepStatus } : s,
              ),
            )
          } else if (event.type === 'vm_step') {
            const idx = event.vm_index as number
            setBulkVmStatuses((prev) => {
              const updated = [...prev]
              updated[idx] = { currentStep: event.step as string, status: event.status as StepStatus }
              return updated
            })
          } else if (event.type === 'vm_done') {
            const idx = event.vm_index as number
            setBulkVmStatuses((prev) => {
              const updated = [...prev]
              updated[idx] = { currentStep: 'done', status: 'done' }
              return updated
            })
            const creds = event.credentials as Record<string, string>
            setBulkCredentials((prev) => [
              ...prev,
              {
                vm_index: idx,
                ip_address: creds.ip_address,
                username: creds.username,
                password: creds.password,
                expires_at: creds.expires_at,
              },
            ])
          } else if (event.type === 'vm_error') {
            const idx = event.vm_index as number
            setBulkVmStatuses((prev) => {
              const updated = [...prev]
              updated[idx] = { currentStep: 'error', status: 'error' }
              return updated
            })
            setBulkErrors((prev) => [
              ...prev,
              { vm_index: idx, message: event.message as string },
            ])
          } else if (event.type === 'complete') {
            break outer
          } else if (event.type === 'error') {
            throw new Error(event.message as string)
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bulk provisioning failed'
      setBulkFatalError(msg)
    }
  }

  function handleModalClose() {
    setModalOpen(false)
    if (credentials) router.push('/vms')
  }

  function handleBulkModalClose() {
    setBulkModalOpen(false)
    router.push('/vms')
  }

  // ---------------------------------------------------------------------------
  // Step content
  // ---------------------------------------------------------------------------
  function StepContent() {
    switch (currentStep.key) {
      case 'os':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">
              {isBulk ? 'Choose a base OS or use your own VM as template' : 'Choose an operating system'}
            </h2>

            {/* Standard OS grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {OS_OPTIONS.map((os) => (
                <button
                  key={os.id}
                  type="button"
                  onClick={() => {
                    setSelectedOs(os.id)
                    if (isBulk) setSelectedSourceVmid(null)
                  }}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-150 active:scale-95 ${
                    selectedOs === os.id && selectedSourceVmid === null
                      ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300 shadow-sm shadow-indigo-900/30'
                      : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                  }`}
                >
                  {os.label}
                </button>
              ))}
            </div>

            {/* Bulk: use own VM as template */}
            {isBulk && (
              <div className="mt-5">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-px flex-1 bg-zinc-800" />
                  <span className="text-xs text-zinc-600">or use your own VM as template</span>
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>

                {userVms.length === 0 ? (
                  <p className="text-sm text-zinc-500">No running VMs available as template source.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {userVms.map((vm) => (
                      <button
                        key={vm.vmid}
                        type="button"
                        onClick={() => {
                          setSelectedSourceVmid(vm.vmid)
                          setSelectedOs(vm.os)
                        }}
                        className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm transition-all duration-150 active:scale-95 ${
                          selectedSourceVmid === vm.vmid
                            ? 'border-amber-600/60 bg-amber-950/30 text-amber-300'
                            : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                        }`}
                      >
                        <span className="flex flex-col items-start gap-0.5">
                          <span className="font-medium">{vm.name || `VM ${vm.vmid}`}</span>
                          <span className="text-xs text-zinc-500">
                            {vm.os} · {vm.cpu_cores}C / {vm.ram_gb}GB · {vm.ip ?? '—'}
                          </span>
                        </span>
                        <span className={`text-xs font-medium ${selectedSourceVmid === vm.vmid ? 'text-amber-400' : 'text-zinc-600'}`}>
                          {selectedSourceVmid === vm.vmid ? 'Selected' : 'Use as template'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {selectedSourceVmid !== null && (
                  <p className="mt-2 text-xs text-amber-400/80">
                    Your VM will be temporarily stopped, cloned to a template, then restarted.
                  </p>
                )}
              </div>
            )}
          </div>
        )

      case 'cpu':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">How many CPU cores?</h2>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCpuCores((v) => Math.max(1, v - 1))}
                disabled={cpuCores <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 transition-all duration-150 hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
              >
                −
              </button>
              <input
                type="number"
                value={cpuCores}
                min={1}
                max={maxCpu}
                onChange={(e) =>
                  setCpuCores(Math.min(maxCpu, Math.max(1, parseInt(e.target.value) || 1)))
                }
                className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg font-semibold text-zinc-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
              <button
                type="button"
                onClick={() => setCpuCores((v) => Math.min(maxCpu, v + 1))}
                disabled={cpuCores >= maxCpu}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 transition-all duration-150 hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
              >
                +
              </button>
              <span className="text-sm text-zinc-500">{maxCpu} available</span>
            </div>
            {cpuPct >= 80 && (
              <p className="mt-3 text-xs text-amber-400">Warning: cluster CPU at {cpuPct.toFixed(0)}%</p>
            )}
          </div>
        )

      case 'ram':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">How much RAM?</h2>
            <div className="flex flex-wrap gap-2">
              {RAM_OPTIONS.map((gb) => (
                <button
                  key={gb}
                  type="button"
                  onClick={() => setRamGb(gb)}
                  disabled={gb > maxRam}
                  className={`rounded-lg border px-5 py-2 text-sm font-medium transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                    ramGb === gb
                      ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300 shadow-sm shadow-indigo-900/30'
                      : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                  }`}
                >
                  {gb} GB
                </button>
              ))}
            </div>
            {ramPct >= 80 && (
              <p className="mt-3 text-xs text-amber-400">Warning: cluster RAM at {ramPct.toFixed(0)}%</p>
            )}
          </div>
        )

      case 'disk':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">How much disk space?</h2>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-zinc-500">Storage</span>
              <span className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm font-semibold text-zinc-200">
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
            {diskPct >= 80 && (
              <p className="mt-3 text-xs text-amber-400">Warning: cluster disk at {diskPct.toFixed(0)}%</p>
            )}
          </div>
        )

      case 'gpu':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">Add a GPU?</h2>
            <div className="mb-4 flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={hasGpu}
                onClick={() => {
                  setHasGpu((v) => !v)
                  if (hasGpu) setSelectedGpu('')
                }}
                className={`relative h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none ${
                  hasGpu ? 'bg-indigo-600' : 'bg-zinc-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    hasGpu ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm text-zinc-300">{hasGpu ? 'Yes, add a GPU' : 'No GPU'}</span>
            </div>
            {hasGpu && (
              <select
                value={selectedGpu}
                onChange={(e) => setSelectedGpu(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              >
                <option value="">Select GPU...</option>
                {availableGpus.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )

      case 'duration':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">How long do you need it?</h2>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((d) => (
                <button
                  key={d.hours}
                  type="button"
                  onClick={() => setDurationHours(d.hours)}
                  className={`rounded-lg border px-6 py-2 text-sm font-medium transition-all duration-150 active:scale-95 ${
                    durationHours === d.hours
                      ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300 shadow-sm shadow-indigo-900/30'
                      : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )

      case 'count_password':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">Batch settings</h2>

            {/* VM count */}
            <div className="mb-5">
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Number of VMs
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setVmCount((v) => Math.max(1, v - 1))}
                  disabled={vmCount <= 1}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 transition-all hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  value={vmCount}
                  min={1}
                  max={50}
                  onChange={(e) => setVmCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-center text-lg font-semibold text-zinc-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                />
                <button
                  type="button"
                  onClick={() => setVmCount((v) => Math.min(50, v + 1))}
                  disabled={vmCount >= 50}
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-200 transition-all hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <span className="text-sm text-zinc-500">max 50</span>
              </div>
            </div>

            {/* Resource summary */}
            {resources && (
              <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3 text-xs flex flex-col gap-1.5">
                {[
                  { label: 'CPU',  needed: totalCpuNeeded,  available: resources.cpu.available,     unit: 'cores' },
                  { label: 'RAM',  needed: totalRamNeeded,  available: resources.ram_gb.available,  unit: 'GB' },
                  { label: 'Disk', needed: totalDiskNeeded, available: resources.disk_gb.available, unit: 'GB' },
                ].map(({ label, needed, available, unit }) => {
                  const fits = needed <= available
                  return (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-zinc-500">{label}</span>
                      <span className={fits ? 'text-zinc-300' : 'font-medium text-red-400'}>
                        {needed} / {available} {unit}
                        {!fits && ' — exceeds available'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Password mode */}
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-300">
                Password assignment
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setPasswordMode('random')}
                  className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-all active:scale-95 ${
                    passwordMode === 'random'
                      ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300'
                      : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div className="font-medium">Random per VM</div>
                  <div className="mt-0.5 text-xs opacity-70">Each VM gets a unique random password</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPasswordMode('unified')}
                  className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-all active:scale-95 ${
                    passwordMode === 'unified'
                      ? 'border-indigo-600/60 bg-indigo-950/60 text-indigo-300'
                      : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  <div className="font-medium">Unified password</div>
                  <div className="mt-0.5 text-xs opacity-70">All VMs share one password</div>
                </button>
              </div>

              {passwordMode === 'unified' && (
                <div className="mt-3">
                  <input
                    type="text"
                    value={unifiedPassword}
                    onChange={(e) => setUnifiedPassword(e.target.value)}
                    placeholder="Enter password (min 8 characters)"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 font-mono placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                  {unifiedPassword.length > 0 && unifiedPassword.length < 8 && (
                    <p className="mt-1 text-xs text-red-400">Password must be at least 8 characters.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )

      case 'review':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">Review your configuration</h2>
            <dl className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-800/40 p-4 text-sm">
              {[
                {
                  label: isBulk ? 'Template' : 'OS',
                  value: selectedSourceVmid !== null
                    ? `Your VM (vmid ${selectedSourceVmid})`
                    : OS_OPTIONS.find((o) => o.id === selectedOs)?.label ?? selectedOs,
                },
                { label: 'CPU',      value: `${cpuCores} cores` },
                { label: 'RAM',      value: `${ramGb} GB` },
                { label: 'Disk',     value: `${diskGb} GB` },
                ...(isBulk
                  ? [
                      { label: 'VM Count',  value: `${vmCount} VMs` },
                      { label: 'Passwords', value: passwordMode === 'unified' ? 'Unified' : 'Random per VM' },
                    ]
                  : [
                      { label: 'GPU', value: hasGpu ? (selectedGpu || '—') : 'None' },
                    ]
                ),
                { label: 'Duration', value: DURATION_OPTIONS.find((d) => d.hours === durationHours)?.label ?? `${durationHours}h` },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <dt className="text-zinc-500">{label}</dt>
                  <dd className="font-medium text-zinc-200">{value}</dd>
                </div>
              ))}
            </dl>
            {!canAfford && cost !== null && (
              <p className="mt-3 text-sm text-red-400">Insufficient points to create {isBulk ? 'these VMs' : 'this VM'}.</p>
            )}
            {isBulk && (!cpuFits || !ramFits || !diskFits) && (
              <div className="mt-3 flex flex-col gap-1">
                {!cpuFits && (
                  <p className="text-sm text-red-400">
                    Not enough CPU: need {totalCpuNeeded} cores, only {resources?.cpu.available ?? 0} available.
                  </p>
                )}
                {!ramFits && (
                  <p className="text-sm text-red-400">
                    Not enough RAM: need {totalRamNeeded}GB, only {resources?.ram_gb.available ?? 0}GB available.
                  </p>
                )}
                {!diskFits && (
                  <p className="text-sm text-red-400">
                    Not enough disk: need {totalDiskNeeded}GB, only {resources?.disk_gb.available ?? 0}GB available.
                  </p>
                )}
              </div>
            )}
          </div>
        )
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="animate-fade-in mb-6 text-2xl font-bold text-zinc-100">
          {isBulk ? 'Bulk Create VMs' : 'Create VM'}
        </h1>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {/* Wizard */}
          <div className="flex flex-1 flex-col gap-5">
            {/* Step indicator */}
            <div className="flex items-center gap-1">
              {visibleSteps.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => i < stepIndex && setStepIndex(i)}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                      i === stepIndex
                        ? 'bg-indigo-600 text-white'
                        : i < stepIndex
                        ? 'cursor-pointer bg-indigo-950 text-indigo-400 hover:bg-indigo-900'
                        : 'bg-zinc-800 text-zinc-600'
                    }`}
                  >
                    {i < stepIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </button>
                  {i < visibleSteps.length - 1 && (
                    <div
                      className={`h-px w-6 transition-colors ${
                        i < stepIndex ? 'bg-indigo-700' : 'bg-zinc-800'
                      }`}
                    />
                  )}
                </div>
              ))}
              <span className="ml-2 text-xs text-zinc-500">{currentStep.label}</span>
            </div>

            {/* Step content */}
            <section className="animate-fade-in rounded-xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-sm">
              {StepContent()}
            </section>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-all duration-150 hover:border-zinc-600 hover:bg-zinc-700 active:scale-95 disabled:opacity-0"
              >
                <span className="inline-flex items-center gap-1.5">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </span>
              </button>

              {currentStep.key === 'review' ? (
                <button
                  type="button"
                  onClick={isBulk ? handleBulkCreate : handleCreate}
                  disabled={!stepValid.review}
                  className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBulk ? `Create ${vmCount} VMs` : 'Create VM'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canNext}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-1.5">
                    Next
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Cost Sidebar */}
          <div className="w-full lg:w-72 lg:shrink-0">
            <div className="animate-fade-in stagger-2 sticky top-20 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5 shadow-sm">
              <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Cost Summary
              </h2>

              <dl className="flex flex-col gap-2.5 text-sm">
                {isBulk ? (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">Per VM</dt>
                      <dd className="font-semibold text-zinc-400">
                        {singleCost !== null ? `${singleCost.toLocaleString()} pts` : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-300">× {vmCount} VMs</dt>
                      <dd className="font-semibold text-zinc-100">
                        {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
                      </dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-zinc-300">Required</dt>
                      <dd className="font-semibold text-zinc-100">
                        {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">CPU</dt>
                      <dd className="font-semibold text-zinc-400">
                        {`${cpuCores * (pricing?.price_cpu || 0) * durationHours} pts`}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">RAM</dt>
                      <dd className="font-semibold text-zinc-400">
                        {`${ramGb * (pricing?.price_ram || 0) * durationHours} pts`}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-zinc-500">Disk</dt>
                      <dd className="font-semibold text-zinc-400">
                        {`${diskGb * (pricing?.price_disk || 0) * durationHours} pts`}
                      </dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <dt className="text-zinc-300">Your balance</dt>
                  <dd className="font-semibold text-zinc-100">
                    {balance.toLocaleString()} pts
                  </dd>
                </div>
                <div className="my-1 border-t border-zinc-800" />
                <div className="flex justify-between">
                  <dt className="text-zinc-300">After purchase</dt>
                  <dd
                    className={`font-bold ${
                      remaining === null
                        ? 'text-zinc-500'
                        : remaining < 0
                        ? 'text-red-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {remaining !== null ? `${remaining.toLocaleString()} pts` : '—'}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-col gap-1">
                {cpuPct >= 80 && <p className="text-xs text-amber-400">Warning: CPU at {cpuPct.toFixed(0)}%</p>}
                {ramPct >= 80 && <p className="text-xs text-amber-400">Warning: RAM at {ramPct.toFixed(0)}%</p>}
                {diskPct >= 80 && <p className="text-xs text-amber-400">Warning: Disk at {diskPct.toFixed(0)}%</p>}
                {!canAfford && cost !== null && (
                  <p className="text-xs text-red-400">Insufficient points.</p>
                )}
              </div>
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
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 transition-all active:scale-95"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {currentStep.key === 'review' ? (
              <button
                type="button"
                onClick={isBulk ? handleBulkCreate : handleCreate}
                disabled={!stepValid.review}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBulk ? `Create ${vmCount} VMs` : 'Create VM'}
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                disabled={!canNext}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-1.5">
                  Next
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Single VM modal */}
      <ProvisioningModal
        open={modalOpen}
        steps={steps}
        credentials={credentials}
        error={provError}
        onClose={handleModalClose}
      />

      {/* Bulk VM modal */}
      <BulkProvisioningModal
        open={bulkModalOpen}
        vmCount={vmCount}
        hasPrepSteps={selectedSourceVmid !== null}
        prepSteps={bulkPrepSteps}
        vmStatuses={bulkVmStatuses}
        credentials={bulkCredentials}
        errors={bulkErrors}
        fatalError={bulkFatalError}
        onClose={handleBulkModalClose}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Page export — wraps inner component in Suspense (required for useSearchParams)
// ---------------------------------------------------------------------------
export default function CreatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-indigo-500" />
        </div>
      }
    >
      <CreatePageContent />
    </Suspense>
  )
}
