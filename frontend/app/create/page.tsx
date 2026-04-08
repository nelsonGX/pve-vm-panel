'use client'

import { useEffect, useState, useCallback, Suspense, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import PInput from '@/components/baseui/pinput'
import PTextarea from '@/components/baseui/ptextarea'
import PToggleButton from '@/components/baseui/ptogglebutton'
import PixelSpinner from '@/components/baseui/spinner'
import { toast } from '@/components/baseui/toast-manager'
import { ChevronsRight, ChevronsLeft } from 'lucide-react'
import VPNConfigModal from '@/components/VPNConfigModal'

const NEED_VPN = process.env.NEXT_PUBLIC_NEED_VPN === 'true'

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

function SelectOptionButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <PButton
      variant={selected ? 'primary' : 'secondary'}
      onClick={onClick}
      disabled={disabled}
      fullWidth
      className={selected ? '' : 'opacity-90'}
      customInnerClass='pt-2 pb-2.5'
    >
      {children}
    </PButton>
  )
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------
type StepKey = 'os' | 'cpu' | 'ram' | 'disk' | 'gpu' | 'duration' | 'count_password' | 'ssh_key' | 'review'

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
  { key: 'ssh_key',  label: 'SSH Key' },
  { key: 'review',   label: 'Review' },
]

const BULK_STEPS: WizardStep[] = [
  { key: 'os',             label: 'OS' },
  { key: 'cpu',            label: 'CPU' },
  { key: 'ram',            label: 'RAM' },
  { key: 'disk',           label: 'Disk' },
  { key: 'duration',       label: 'Duration' },
  { key: 'count_password', label: 'Batch' },
  { key: 'ssh_key',        label: 'SSH Key' },
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

  // SSH key
  const [sshPublicKey, setSshPublicKey] = useState('')

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

  // VPN config prompt (shown after first VM creation when NEED_VPN=true)
  const [hasVpnConfig, setHasVpnConfig] = useState(true)  // assume true until checked
  const [vpnModalOpen, setVpnModalOpen] = useState(false)

  // Bulk provisioning modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkPrepSteps, setBulkPrepSteps] = useState<PrepStep[]>([])
  const [bulkVmStatuses, setBulkVmStatuses] = useState<BulkVMStatus[]>([])
  const [bulkCredentials, setBulkCredentials] = useState<BulkCredential[]>([])
  const [bulkErrors, setBulkErrors] = useState<{ vm_index: number; message: string }[]>([])
  const [bulkFatalError, setBulkFatalError] = useState<string | null>(null)
  const warningToastStateRef = useRef({
    cpuHigh: false,
    ramHigh: false,
    diskHigh: false,
    sourceSelected: false,
  })

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

      if (NEED_VPN) {
        try {
          await clientApiFetch('/vpn/config')
          setHasVpnConfig(true)
        } catch {
          setHasVpnConfig(false)
        }
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

  useEffect(() => {
    const cpuHigh = cpuPct >= 80
    if (cpuHigh && !warningToastStateRef.current.cpuHigh) {
      toast.warning(`Cluster CPU is at ${cpuPct.toFixed(0)}%.`)
    }
    warningToastStateRef.current.cpuHigh = cpuHigh
  }, [cpuPct])

  useEffect(() => {
    const ramHigh = ramPct >= 80
    if (ramHigh && !warningToastStateRef.current.ramHigh) {
      toast.warning(`Cluster RAM is at ${ramPct.toFixed(0)}%.`)
    }
    warningToastStateRef.current.ramHigh = ramHigh
  }, [ramPct])

  useEffect(() => {
    const diskHigh = diskPct >= 80
    if (diskHigh && !warningToastStateRef.current.diskHigh) {
      toast.warning(`Cluster disk is at ${diskPct.toFixed(0)}%.`)
    }
    warningToastStateRef.current.diskHigh = diskHigh
  }, [diskPct])

  useEffect(() => {
    const sourceSelected = selectedSourceVmid !== null
    if (sourceSelected && !warningToastStateRef.current.sourceSelected) {
      toast.warning('Your VM will be temporarily stopped, cloned to a template, then restarted.', {
        autoClose: true,
        autoCloseDelay: 5000
      })
    }
    warningToastStateRef.current.sourceSelected = sourceSelected
  }, [selectedSourceVmid])

  if (status === 'loading' || dataLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelSpinner color="bg-blue-400" size={10} />
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
        <PDiv shadowColor="red-800" borderColor="red-400" padding="p-6" className="max-w-lg">
          <div className="text-center">
            <p className="mb-3 text-red-400">{dataError}</p>
            <PButton variant="primary" onClick={loadData}>Retry</PButton>
          </div>
        </PDiv>
      </div>
    )
  }

  // Build visible steps
  const baseSteps = isBulk ? BULK_STEPS : NORMAL_STEPS
  const visibleSteps = baseSteps.filter((s) => s.key !== 'gpu' || gpuAvailable)
  const currentStep = visibleSteps[stepIndex]

  // Total resources needed
  const totalCpuNeeded  = cpuCores * vmCount
  const totalRamNeeded  = ramGb    * vmCount
  const totalDiskNeeded = diskGb   * vmCount

  const cpuFits  = resources ? totalCpuNeeded  <= resources.cpu.available     : true
  const ramFits  = resources ? totalRamNeeded  <= resources.ram_gb.available  : true
  const diskFits = resources ? totalDiskNeeded <= resources.disk_gb.available : true

  // Per-step "next" validity
  const sshKeyValid = sshPublicKey.trim() === '' || /^(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+\S/.test(sshPublicKey.trim())

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
    ssh_key:        sshKeyValid,
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
      ssh_public_key: sshPublicKey.trim() || undefined,
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

          if (event.type === 'clone_progress') {
            setSteps((prev) =>
              prev.map((s) => s.key === 'clone' ? { ...s, progress: event.percent as number } : s),
            )
          } else if (event.type === 'step') {
            setSteps((prev) =>
              prev.map((s) =>
                s.key === event.step ? { ...s, status: event.status as StepStatus, progress: undefined } : s,
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
            if (NEED_VPN && !hasVpnConfig) {
              setVpnModalOpen(true)
            }
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
      ssh_public_key: sshPublicKey.trim() || undefined,
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
          } else if (event.type === 'vm_clone_progress') {
            const idx = event.vm_index as number
            setBulkVmStatuses((prev) => {
              const updated = [...prev]
              updated[idx] = { ...updated[idx], cloneProgress: event.percent as number }
              return updated
            })
          } else if (event.type === 'vm_step') {
            const idx = event.vm_index as number
            setBulkVmStatuses((prev) => {
              const updated = [...prev]
              updated[idx] = { currentStep: event.step as string, status: event.status as StepStatus, cloneProgress: undefined }
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
    if (credentials) {
      toast.success('VM created successfully.')
      router.push('/vms')
    }
  }

  function handleBulkModalClose() {
    setBulkModalOpen(false)
    const successCount = bulkCredentials.length
    if (successCount > 0) toast.success(`${successCount} VM${successCount !== 1 ? 's' : ''} created successfully.`)
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

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {OS_OPTIONS.map((os) => (
                <SelectOptionButton
                  key={os.id}
                  selected={selectedOs === os.id && selectedSourceVmid === null}
                  onClick={() => {
                    setSelectedOs(os.id)
                    if (isBulk) setSelectedSourceVmid(null)
                  }}
                >
                  {os.label}
                </SelectOptionButton>
              ))}
            </div>

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
                      <SelectOptionButton
                        key={vm.vmid}
                        selected={selectedSourceVmid === vm.vmid}
                        onClick={() => {
                          setSelectedSourceVmid(vm.vmid)
                          setSelectedOs(vm.os)
                        }}
                      >
                        <span className="flex items-center justify-between w-full gap-4">
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="font-medium">{vm.name || `VM ${vm.vmid}`}</span>
                            <span className="text-xs opacity-70">
                              {vm.os} · {vm.cpu_cores}C / {vm.ram_gb}GB · {vm.ip ?? '—'}
                            </span>
                          </span>
                          <span className="text-xs font-medium opacity-70">
                            {selectedSourceVmid === vm.vmid ? 'Selected' : 'Use as template'}
                          </span>
                        </span>
                      </SelectOptionButton>
                    ))}
                  </div>
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
              <PButton
                variant="secondary"
                disabled={cpuCores <= 1}
                onClick={() => setCpuCores((v) => Math.max(1, v - 1))}
              >
                -
              </PButton>
              <PInput
                type="number"
                value={String(cpuCores)}
                onChange={(e) =>
                  setCpuCores(Math.min(maxCpu, Math.max(1, parseInt(e.target.value) || 1)))
                }
                className="text-center"
              />
              <PButton
                variant="secondary"
                disabled={cpuCores >= maxCpu}
                onClick={() => setCpuCores((v) => Math.min(maxCpu, v + 1))}
              >
                +
              </PButton>
              <span className="shrink-0 text-sm text-zinc-500">{maxCpu} avail.</span>
            </div>
          </div>
        )

      case 'ram':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">How much RAM?</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {RAM_OPTIONS.map((gb) => (
                <SelectOptionButton
                  key={gb}
                  selected={ramGb === gb}
                  disabled={gb > maxRam}
                  onClick={() => setRamGb(gb)}
                >
                  {gb} GB
                </SelectOptionButton>
              ))}
            </div>
          </div>
        )

      case 'disk':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">How much disk space?</h2>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-zinc-500">Storage</span>
              <span className="border border-zinc-700 bg-zinc-800 px-3 py-1 text-sm font-semibold text-zinc-200">
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
              className="w-full accent-blue-500"
            />
            <div className="mt-1.5 flex justify-between text-xs text-zinc-600">
              <span>10 GB</span>
              <span>{maxDisk} GB</span>
            </div>
          </div>
        )

      case 'gpu':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">Add a GPU?</h2>
            <div className="mb-4 flex items-center gap-3">
              <PToggleButton
                checked={hasGpu}
                onChange={(v) => {
                  setHasGpu(v)
                  if (!v) setSelectedGpu('')
                }}
                leftLabel="No GPU"
                rightLabel="Add GPU"
              />
            </div>
            {hasGpu && (
              <PDiv fullWidth padding="p-0">
                <select
                  value={selectedGpu}
                  onChange={(e) => setSelectedGpu(e.target.value)}
                  className="w-full bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none"
                >
                  <option value="">Select GPU...</option>
                  {availableGpus.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </PDiv>
            )}
          </div>
        )

      case 'duration':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">How long do you need it?</h2>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((d) => (
                <SelectOptionButton
                  key={d.hours}
                  selected={durationHours === d.hours}
                  onClick={() => setDurationHours(d.hours)}
                >
                  {d.label}
                </SelectOptionButton>
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
                <PButton
                  variant="secondary"
                  customInnerClass="py-2"
                  disabled={vmCount <= 1}
                  onClick={() => setVmCount((v) => Math.max(1, v - 1))}
                >
                  −
                </PButton>
                <PInput
                  type="number"
                  value={String(vmCount)}
                  onChange={(e) => setVmCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                  minWidth="6rem"
                  className="text-center"
                />
                <PButton
                  variant="secondary"
                  customInnerClass="py-2"
                  disabled={vmCount >= 50}
                  onClick={() => setVmCount((v) => Math.min(50, v + 1))}
                >
                  +
                </PButton>
                <span className="text-sm text-zinc-500">max 50</span>
              </div>
            </div>

            {/* Resource summary */}
            {resources && (
              <div className="mb-5 border border-zinc-700 bg-zinc-800/40 p-3 text-xs flex flex-col gap-1.5">
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
                <SelectOptionButton
                  selected={passwordMode === 'random'}
                  onClick={() => setPasswordMode('random')}
                >
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="font-medium">Random per VM</span>
                    <span className="text-xs opacity-70">Each VM gets a unique random password</span>
                  </span>
                </SelectOptionButton>
                <SelectOptionButton
                  selected={passwordMode === 'unified'}
                  onClick={() => setPasswordMode('unified')}
                >
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="font-medium">Unified password</span>
                    <span className="text-xs opacity-70">All VMs share one password</span>
                  </span>
                </SelectOptionButton>
              </div>

              {passwordMode === 'unified' && (
                <div className="mt-3">
                  <PInput
                    type="text"
                    value={unifiedPassword}
                    onChange={(e) => setUnifiedPassword(e.target.value)}
                    placeholder="Enter password (min 8 characters)"
                    className="w-full"
                    minWidth="100%"
                  />
                  {unifiedPassword.length > 0 && unifiedPassword.length < 8 && (
                    <p className="mt-1 text-xs text-red-400">Password must be at least 8 characters.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )

      case 'ssh_key':
        return (
          <div>
            <h2 className="mb-2 text-lg font-semibold text-zinc-100">SSH Public Key <span className="text-sm font-normal text-zinc-500">(optional)</span></h2>
            <p className="mb-4 text-sm text-zinc-500">
              Paste your SSH public key to enable key-based login. Leave blank to use password only.
            </p>
            <PTextarea
              value={sshPublicKey}
              onChange={(e) => setSshPublicKey(e.target.value)}
              placeholder="ssh-ed25519 AAAA... user@host"
              rows={4}
              minWidth="100%"
              className="w-full"
            />
            {sshPublicKey.trim() !== '' && !sshKeyValid && (
              <p className="mt-2 text-xs text-red-400">Invalid SSH public key format.</p>
            )}
          </div>
        )

      case 'review':
        return (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-zinc-100">Review your configuration</h2>
            <PDiv fullWidth padding="p-4">
              <dl className="flex flex-col gap-3 text-sm">
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
                  { label: 'SSH Key', value: sshPublicKey.trim() ? 'Provided' : 'None (password only)' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between border-b border-zinc-800 pb-2 last:border-0 last:pb-0">
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="font-medium text-zinc-200">{value}</dd>
                  </div>
                ))}
              </dl>
            </PDiv>
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
      <div className="mx-auto w-full max-w-5xl px-4 py-8 pb-24 lg:pb-8">
        <h1 className="animate-fade-in mb-6 text-2xl font-bold text-zinc-100">
          {isBulk ? 'Bulk Create VMs' : 'Create VM'}
        </h1>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {/* Wizard */}
          <div className="flex flex-1 flex-col gap-5">
            {/* Step indicator */}
            <div className="flex items-center gap-0.5 overflow-x-auto pb-1 sm:gap-1 sm:pb-0">
              {visibleSteps.map((s, i) => (
                <div key={s.key} className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                  <button
                    type="button"
                    onClick={() => i < stepIndex && setStepIndex(i)}
                    className={`flex h-6 w-6 items-center justify-center text-xs font-semibold border-2 transition-colors sm:h-7 sm:w-7 ${
                      i === stepIndex
                        ? 'border-blue-400 bg-blue-700 text-white'
                        : i < stepIndex
                        ? 'cursor-pointer border-blue-700 bg-blue-950 text-blue-400 hover:bg-blue-900'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-600'
                    }`}
                  >
                    {i < stepIndex ? '✓' : i + 1}
                  </button>
                  {i < visibleSteps.length - 1 && (
                    <div
                      className={`h-px w-3 shrink-0 transition-colors sm:w-6 ${
                        i < stepIndex ? 'bg-blue-700' : 'bg-zinc-800'
                      }`}
                    />
                  )}
                </div>
              ))}
              <span className="ml-2 shrink-0 text-xs text-zinc-500">{currentStep.label}</span>
            </div>

            {/* Step content */}
            <PDiv fullWidth padding="p-6" className="animate-fade-in">
              <section>
                {StepContent()}
              </section>
            </PDiv>

            {/* Navigation — hidden on mobile (bottom bar handles it) */}
            <div className="hidden items-center justify-between lg:flex">
              <PButton
                variant="secondary"
                disabled={stepIndex === 0}
                className={stepIndex === 0 ? 'invisible' : ''}
                onClick={goBack}
              >
                <div className="flex items-center gap-1">
                  <ChevronsLeft />
                  <span>Back</span>
                </div>
              </PButton>

              {currentStep.key === 'review' ? (
                <PButton
                  variant="primary"
                  disabled={!stepValid.review}
                  onClick={isBulk ? handleBulkCreate : handleCreate}
                >
                  {isBulk ? `Create ${vmCount} VMs` : 'Create VM'}
                </PButton>
              ) : (
                <PButton
                  variant="primary"
                  disabled={!canNext}
                  onClick={goNext}
                >
                  <div className="flex items-center gap-1">
                    <span>Next</span> <ChevronsRight />
                  </div>
                </PButton>
              )}
            </div>
          </div>

          {/* Cost Sidebar */}
          <div className="w-full lg:w-72 lg:shrink-0">
            <PDiv fullWidth padding="p-5" className="animate-fade-in stagger-2 sticky top-20">
              <div>
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
                  <div className="my-1 border-t border-zinc-700" />
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

                {!canAfford && cost !== null && (
                  <div className="mt-3">
                    <p className="text-xs text-red-400">Insufficient points.</p>
                  </div>
                )}
              </div>
            </PDiv>
          </div>
        </div>
      </div>

      {/* Mobile cost bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t-2 border-zinc-700 bg-zinc-900/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 flex-col text-sm">
            <span className="truncate text-xs text-zinc-500">{currentStep.label}</span>
            <div>
              <span className="text-zinc-500">Cost: </span>
              <span className="font-bold text-zinc-100">
                {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <PButton variant="secondary" customInnerClass="py-2" onClick={goBack}>
                <ChevronsLeft />
              </PButton>
            )}
            {currentStep.key === 'review' ? (
              <PButton
                variant="primary"
                disabled={!stepValid.review}
                onClick={isBulk ? handleBulkCreate : handleCreate}
              >
                {isBulk ? `Create ${vmCount} VMs` : 'Create VM'}
              </PButton>
            ) : (
              <PButton
                variant="primary"
                disabled={!canNext}
                onClick={goNext}
                customInnerClass="py-1.5"
              >
                <div className="flex items-center gap-1">
                  Next <ChevronsRight />
                </div>
              </PButton>
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

      {/* VPN config prompt — shown after first VM creation */}
      {NEED_VPN && (
        <VPNConfigModal
          open={vpnModalOpen}
          onClose={() => { setVpnModalOpen(false); setHasVpnConfig(true) }}
          isFirstTime
        />
      )}
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
          <PixelSpinner color="bg-blue-400" size={10} />
        </div>
      }
    >
      <CreatePageContent />
    </Suspense>
  )
}
