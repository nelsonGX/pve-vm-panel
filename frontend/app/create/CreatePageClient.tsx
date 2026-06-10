'use client'

import { useEffect, useState, useCallback, Suspense, useRef, useReducer } from 'react'
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
import { toast } from '@/components/baseui/toast-api'
import { ChevronsRight, ChevronsLeft } from 'lucide-react'
import VPNConfigModal from '@/components/VPNConfigModal'
import { DURATION_OPTIONS, computeCost, durationLabel, type PricingData } from '@/lib/vm'

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

const PREP_STEP_LABELS: Record<string, string> = {
  stop_source: 'Stopping source VM',
  clone_template: 'Cloning to template',
  convert_template: 'Converting to template',
  start_source: 'Restarting source VM',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

type SseEvent = Record<string, unknown>
type SseEventResult = 'continue' | 'stop' | void

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => SseEventResult,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const readNext = (): Promise<void> =>
    reader.read().then(({ done, value }) => {
      if (done) return

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        let event: SseEvent
        try {
          event = JSON.parse(line.slice(6)) as SseEvent
        } catch {
          continue
        }

        if (onEvent(event) === 'stop') return
      }

      return readNext()
    })

  await readNext()
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------
type StepKey = 'os' | 'cpu' | 'ram' | 'disk' | 'gpu' | 'duration' | 'count_password' | 'ssh_key' | 'review'

interface WizardStep {
  key: StepKey
  label: string
}

interface CreateFormState {
  selectedOs: string
  cpuCores: number
  ramGb: number
  diskGb: number
  hasGpu: boolean
  selectedGpu: string
  durationHours: number
  sshPublicKey: string
  vmCount: number
  passwordMode: 'random' | 'unified'
  unifiedPassword: string
  selectedSourceVmid: number | null
}

type CreateFormAction =
  | { type: 'fieldChanged'; name: 'selectedOs' | 'selectedGpu' | 'sshPublicKey' | 'unifiedPassword'; value: string }
  | { type: 'fieldChanged'; name: 'cpuCores' | 'ramGb' | 'diskGb' | 'durationHours' | 'vmCount'; value: number }
  | { type: 'fieldChanged'; name: 'hasGpu'; value: boolean }
  | { type: 'fieldChanged'; name: 'passwordMode'; value: 'random' | 'unified' }
  | { type: 'fieldChanged'; name: 'selectedSourceVmid'; value: number | null }
  | { type: 'osOptionSelected'; os: string; clearSource: boolean }
  | { type: 'sourceVmSelected'; vmid: number; os: string }
  | { type: 'gpuEnabledChanged'; value: boolean }

const createFormInitialState: CreateFormState = {
  selectedOs: '',
  cpuCores: 16,
  ramGb: 32,
  diskGb: 50,
  hasGpu: false,
  selectedGpu: '',
  durationHours: 1,
  sshPublicKey: '',
  vmCount: 5,
  passwordMode: 'random',
  unifiedPassword: '',
  selectedSourceVmid: null,
}

function createFormReducer(state: CreateFormState, action: CreateFormAction): CreateFormState {
  switch (action.type) {
    case 'fieldChanged':
      return { ...state, [action.name]: action.value }
    case 'osOptionSelected':
      return {
        ...state,
        selectedOs: action.os,
        selectedSourceVmid: action.clearSource ? null : state.selectedSourceVmid,
      }
    case 'sourceVmSelected':
      return {
        ...state,
        selectedSourceVmid: action.vmid,
        selectedOs: action.os,
      }
    case 'gpuEnabledChanged':
      return {
        ...state,
        hasGpu: action.value,
        selectedGpu: action.value ? state.selectedGpu : '',
      }
  }
}

interface CreateDataState {
  resources: ResourcesData | null
  pricing: PricingData | null
  me: MeData | null
  userVms: VM[]
  loading: boolean
  error: string | null
}

type CreateDataAction =
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; resources: ResourcesData; pricing: PricingData; me: MeData; userVms?: VM[] }
  | { type: 'loadFailed'; error: string }

const createDataInitialState: CreateDataState = {
  resources: null,
  pricing: null,
  me: null,
  userVms: [],
  loading: true,
  error: null,
}

function createDataReducer(state: CreateDataState, action: CreateDataAction): CreateDataState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, loading: true, error: null }
    case 'loadSucceeded':
      return {
        ...state,
        resources: action.resources,
        pricing: action.pricing,
        me: action.me,
        userVms: action.userVms ?? [],
        loading: false,
      }
    case 'loadFailed':
      return { ...state, loading: false, error: action.error }
  }
}

interface ProvisioningModalState {
  modalOpen: boolean
  steps: ProvisioningStep[]
  credentials: VMCredentials | null
  provError: string | null
}

type ProvisioningModalAction =
  | { type: 'opened'; steps: ProvisioningStep[] }
  | { type: 'closed' }
  | { type: 'stepsChanged'; updater: (steps: ProvisioningStep[]) => ProvisioningStep[] }
  | { type: 'credentialsChanged'; value: VMCredentials | null }
  | { type: 'errorChanged'; value: string | null }

const provisioningModalInitialState: ProvisioningModalState = {
  modalOpen: false,
  steps: [],
  credentials: null,
  provError: null,
}

function provisioningModalReducer(
  state: ProvisioningModalState,
  action: ProvisioningModalAction,
): ProvisioningModalState {
  switch (action.type) {
    case 'opened':
      return {
        modalOpen: true,
        steps: action.steps,
        credentials: null,
        provError: null,
      }
    case 'closed':
      return { ...state, modalOpen: false }
    case 'stepsChanged':
      return { ...state, steps: action.updater(state.steps) }
    case 'credentialsChanged':
      return { ...state, credentials: action.value }
    case 'errorChanged':
      return { ...state, provError: action.value }
  }
}

interface VpnPromptState {
  hasConfig: boolean
  modalOpen: boolean
}

type VpnPromptAction =
  | { type: 'configChanged'; value: boolean }
  | { type: 'modalOpened' }
  | { type: 'modalClosedWithConfig' }

const vpnPromptInitialState: VpnPromptState = {
  hasConfig: true,
  modalOpen: false,
}

function vpnPromptReducer(state: VpnPromptState, action: VpnPromptAction): VpnPromptState {
  switch (action.type) {
    case 'configChanged':
      return { ...state, hasConfig: action.value }
    case 'modalOpened':
      return { ...state, modalOpen: true }
    case 'modalClosedWithConfig':
      return { hasConfig: true, modalOpen: false }
  }
}

interface BulkProvisioningModalState {
  modalOpen: boolean
  prepSteps: PrepStep[]
  vmStatuses: BulkVMStatus[]
  credentials: BulkCredential[]
  errors: { vm_index: number; message: string }[]
  fatalError: string | null
}

type BulkProvisioningModalAction =
  | { type: 'opened'; prepSteps: PrepStep[]; vmCount: number }
  | { type: 'closed' }
  | { type: 'prepStepsChanged'; updater: (steps: PrepStep[]) => PrepStep[] }
  | { type: 'vmStatusesChanged'; updater: (statuses: BulkVMStatus[]) => BulkVMStatus[] }
  | { type: 'credentialAdded'; value: BulkCredential }
  | { type: 'errorAdded'; value: { vm_index: number; message: string } }
  | { type: 'fatalErrorChanged'; value: string | null }

const bulkProvisioningModalInitialState: BulkProvisioningModalState = {
  modalOpen: false,
  prepSteps: [],
  vmStatuses: [],
  credentials: [],
  errors: [],
  fatalError: null,
}

function bulkProvisioningModalReducer(
  state: BulkProvisioningModalState,
  action: BulkProvisioningModalAction,
): BulkProvisioningModalState {
  switch (action.type) {
    case 'opened':
      return {
        modalOpen: true,
        prepSteps: action.prepSteps,
        vmStatuses: Array.from(
          { length: action.vmCount },
          () => ({ currentStep: 'waiting', status: 'pending' as StepStatus }),
        ),
        credentials: [],
        errors: [],
        fatalError: null,
      }
    case 'closed':
      return { ...state, modalOpen: false }
    case 'prepStepsChanged':
      return { ...state, prepSteps: action.updater(state.prepSteps) }
    case 'vmStatusesChanged':
      return { ...state, vmStatuses: action.updater(state.vmStatuses) }
    case 'credentialAdded':
      return { ...state, credentials: [...state.credentials, action.value] }
    case 'errorAdded':
      return { ...state, errors: [...state.errors, action.value] }
    case 'fatalErrorChanged':
      return { ...state, fatalError: action.value }
  }
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
function useCreatePageContent() {
  const { status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isBulk = searchParams.has('bulk')

  const [formState, dispatchForm] = useReducer(createFormReducer, createFormInitialState)
  const {
    selectedOs,
    cpuCores,
    ramGb,
    diskGb,
    hasGpu,
    selectedGpu,
    durationHours,
    sshPublicKey,
    vmCount,
    passwordMode,
    unifiedPassword,
    selectedSourceVmid,
  } = formState

  // Wizard step
  const [stepIndex, setStepIndex] = useState(0)

  const [dataState, dispatchData] = useReducer(createDataReducer, createDataInitialState)
  const {
    resources,
    pricing,
    me,
    userVms,
    loading: dataLoading,
    error: dataError,
  } = dataState

  const [provisioningState, dispatchProvisioning] = useReducer(
    provisioningModalReducer,
    provisioningModalInitialState,
  )
  const {
    modalOpen,
    steps,
    credentials,
    provError,
  } = provisioningState

  const [vpnPromptState, dispatchVpnPrompt] = useReducer(vpnPromptReducer, vpnPromptInitialState)
  const { hasConfig: hasVpnConfig, modalOpen: vpnModalOpen } = vpnPromptState

  const [bulkProvisioningState, dispatchBulkProvisioning] = useReducer(
    bulkProvisioningModalReducer,
    bulkProvisioningModalInitialState,
  )
  const {
    modalOpen: bulkModalOpen,
    prepSteps: bulkPrepSteps,
    vmStatuses: bulkVmStatuses,
    credentials: bulkCredentials,
    errors: bulkErrors,
    fatalError: bulkFatalError,
  } = bulkProvisioningState
  const warningToastStateRef = useRef({
    cpuHigh: false,
    ramHigh: false,
    diskHigh: false,
    sourceSelected: false,
  })
  const bulkCredentialsToastShownRef = useRef(false)

  // ---------------------------------------------------------------------------
  // Load initial data
  // ---------------------------------------------------------------------------
  const loadData = useCallback(async () => {
    dispatchData({ type: 'loadStarted' })
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
        dispatchData({
          type: 'loadSucceeded',
          resources: res as ResourcesData,
          pricing: price as PricingData,
          me: user as MeData,
          userVms: ((vms as VM[]) ?? []).filter((v) => v.status === 'running'),
        })
      } else {
        const [res, price, user] = await Promise.all(baseRequests)
        dispatchData({
          type: 'loadSucceeded',
          resources: res as ResourcesData,
          pricing: price as PricingData,
          me: user as MeData,
        })
      }

      if (NEED_VPN) {
        try {
          await clientApiFetch('/vpn/config')
          dispatchVpnPrompt({ type: 'configChanged', value: true })
        } catch {
          dispatchVpnPrompt({ type: 'configChanged', value: false })
        }
      }
    } catch (err) {
      dispatchData({
        type: 'loadFailed',
        error: err instanceof Error ? err.message : 'Failed to load data',
      })
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
    resources?.gpus.flatMap((g) => (
      g.available ? [{ id: g.id, name: g.id, available: true }] : []
    )) ?? []
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
    dispatchProvisioning({ type: 'opened', steps: initialSteps })

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

      await readSseStream(response.body, (event) => {
        if (event.type === 'clone_progress') {
          dispatchProvisioning({
            type: 'stepsChanged',
            updater: (prev) =>
              prev.map((s) => s.key === 'clone' ? { ...s, progress: event.percent as number } : s),
          })
        } else if (event.type === 'step') {
          dispatchProvisioning({
            type: 'stepsChanged',
            updater: (prev) =>
              prev.map((s) =>
                s.key === event.step ? { ...s, status: event.status as StepStatus, progress: undefined } : s,
              ),
          })
        } else if (event.type === 'complete') {
          dispatchProvisioning({
            type: 'stepsChanged',
            updater: (prev) =>
              prev.map((s) =>
                s.status === 'loading' || s.status === 'pending' ? { ...s, status: 'done' } : s,
              ),
          })
          const d = event.data as Record<string, string>
          dispatchProvisioning({
            type: 'credentialsChanged',
            value: {
              ip_address: d.ip_address,
              username: d.username,
              password: d.password,
              expires_at: d.expires_at,
            },
          })
          if (NEED_VPN && !hasVpnConfig) {
            dispatchVpnPrompt({ type: 'modalOpened' })
          }
          toast.warning("You won't be able to see these credentials again. Copy them somewhere safe.", {
            autoClose: true,
            autoCloseDelay: 5000,
          })
          return 'stop'
        } else if (event.type === 'error') {
          throw new Error(event.message as string)
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Provisioning failed'
      dispatchProvisioning({ type: 'errorChanged', value: msg })
      toast.error(msg, { autoClose: false })
      dispatchProvisioning({
        type: 'stepsChanged',
        updater: (prev) =>
          prev.map((s) => (s.status === 'loading' ? { ...s, status: 'error' } : s)),
      })
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

    dispatchBulkProvisioning({ type: 'opened', prepSteps: initialPrepSteps, vmCount })
    bulkCredentialsToastShownRef.current = false

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

      await readSseStream(response.body, (event) => {
        if (event.type === 'prep_step') {
          dispatchBulkProvisioning({
            type: 'prepStepsChanged',
            updater: (prev) =>
              prev.map((s) =>
                s.key === event.step ? { ...s, status: event.status as StepStatus } : s,
              ),
          })
        } else if (event.type === 'vm_clone_progress') {
          const idx = event.vm_index as number
          dispatchBulkProvisioning({
            type: 'vmStatusesChanged',
            updater: (prev) => {
              const updated = [...prev]
              updated[idx] = { ...updated[idx], cloneProgress: event.percent as number }
              return updated
            },
          })
        } else if (event.type === 'vm_step') {
          const idx = event.vm_index as number
          dispatchBulkProvisioning({
            type: 'vmStatusesChanged',
            updater: (prev) => {
              const updated = [...prev]
              updated[idx] = { currentStep: event.step as string, status: event.status as StepStatus, cloneProgress: undefined }
              return updated
            },
          })
        } else if (event.type === 'vm_done') {
          const idx = event.vm_index as number
          dispatchBulkProvisioning({
            type: 'vmStatusesChanged',
            updater: (prev) => {
              const updated = [...prev]
              updated[idx] = { currentStep: 'done', status: 'done' }
              return updated
            },
          })
          const creds = event.credentials as Record<string, string>
          dispatchBulkProvisioning({
            type: 'credentialAdded',
            value: {
              vm_index: idx,
              ip_address: creds.ip_address,
              username: creds.username,
              password: creds.password,
              expires_at: creds.expires_at,
            },
          })
          if (!bulkCredentialsToastShownRef.current) {
            bulkCredentialsToastShownRef.current = true
            toast.warning("Save these credentials now. You won't be able to see them again.", {
              autoClose: true,
              autoCloseDelay: 7000,
            })
          }
        } else if (event.type === 'vm_error') {
          const idx = event.vm_index as number
          dispatchBulkProvisioning({
            type: 'vmStatusesChanged',
            updater: (prev) => {
              const updated = [...prev]
              updated[idx] = { currentStep: 'error', status: 'error' }
              return updated
            },
          })
          dispatchBulkProvisioning({
            type: 'errorAdded',
            value: { vm_index: idx, message: event.message as string },
          })
        } else if (event.type === 'complete') {
          return 'stop'
        } else if (event.type === 'error') {
          throw new Error(event.message as string)
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bulk provisioning failed'
      dispatchBulkProvisioning({ type: 'fatalErrorChanged', value: msg })
      toast.error(msg, { autoClose: false })
    }
  }

  function handleModalClose() {
    dispatchProvisioning({ type: 'closed' })
    if (credentials) {
      toast.success('VM created successfully.')
      router.push('/vms')
    }
  }

  function handleBulkModalClose() {
    dispatchBulkProvisioning({ type: 'closed' })
    const successCount = bulkCredentials.length
    if (successCount > 0) toast.success(`${successCount} VM${successCount !== 1 ? 's' : ''} created successfully.`)
    router.push('/vms')
  }

  // ---------------------------------------------------------------------------
  // Step content
  // ---------------------------------------------------------------------------
  function stepContent() {
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
                    dispatchForm({ type: 'osOptionSelected', os: os.id, clearSource: isBulk })
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
                          dispatchForm({ type: 'sourceVmSelected', vmid: vm.vmid, os: vm.os })
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
                onClick={() => dispatchForm({ type: 'fieldChanged', name: 'cpuCores', value: Math.max(1, cpuCores - 1) })}
              >
                -
              </PButton>
              <PInput
                type="number"
                value={String(cpuCores)}
                onChange={(e) =>
                  dispatchForm({
                    type: 'fieldChanged',
                    name: 'cpuCores',
                    value: Math.min(maxCpu, Math.max(1, parseInt(e.target.value) || 1)),
                  })
                }
                className="text-center"
              />
              <PButton
                variant="secondary"
                disabled={cpuCores >= maxCpu}
                onClick={() => dispatchForm({ type: 'fieldChanged', name: 'cpuCores', value: Math.min(maxCpu, cpuCores + 1) })}
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
                  onClick={() => dispatchForm({ type: 'fieldChanged', name: 'ramGb', value: gb })}
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
              aria-label="Disk space"
              type="range"
              min={10}
              max={maxDisk}
              step={10}
              value={diskGb}
              onChange={(e) => dispatchForm({ type: 'fieldChanged', name: 'diskGb', value: parseInt(e.target.value) })}
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
                onChange={(v) => dispatchForm({ type: 'gpuEnabledChanged', value: v })}
                leftLabel="No GPU"
                rightLabel="Add GPU"
              />
            </div>
            {hasGpu && (
              <PDiv fullWidth padding="p-0">
                <select
                  value={selectedGpu}
                  onChange={(e) => dispatchForm({ type: 'fieldChanged', name: 'selectedGpu', value: e.target.value })}
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
                  onClick={() => dispatchForm({ type: 'fieldChanged', name: 'durationHours', value: d.hours })}
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
              <label htmlFor="bulk-vm-count" className="mb-2 block text-sm font-medium text-zinc-300">
                Number of VMs
              </label>
              <div className="flex items-center gap-3">
                <PButton
                  variant="secondary"
                  customInnerClass="py-2"
                  disabled={vmCount <= 1}
                  onClick={() => dispatchForm({ type: 'fieldChanged', name: 'vmCount', value: Math.max(1, vmCount - 1) })}
                >
                  −
                </PButton>
                <PInput
                  id="bulk-vm-count"
                  type="number"
                  value={String(vmCount)}
                  onChange={(e) => dispatchForm({
                    type: 'fieldChanged',
                    name: 'vmCount',
                    value: Math.min(50, Math.max(1, parseInt(e.target.value) || 1)),
                  })}
                  minWidth="6rem"
                  className="text-center"
                />
                <PButton
                  variant="secondary"
                  customInnerClass="py-2"
                  disabled={vmCount >= 50}
                  onClick={() => dispatchForm({ type: 'fieldChanged', name: 'vmCount', value: Math.min(50, vmCount + 1) })}
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
              <p className="mb-2 text-sm font-medium text-zinc-300">
                Password assignment
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <SelectOptionButton
                  selected={passwordMode === 'random'}
                  onClick={() => dispatchForm({ type: 'fieldChanged', name: 'passwordMode', value: 'random' })}
                >
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="font-medium">Random per VM</span>
                    <span className="text-xs opacity-70">Each VM gets a unique random password</span>
                  </span>
                </SelectOptionButton>
                <SelectOptionButton
                  selected={passwordMode === 'unified'}
                  onClick={() => dispatchForm({ type: 'fieldChanged', name: 'passwordMode', value: 'unified' })}
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
                    onChange={(e) => dispatchForm({ type: 'fieldChanged', name: 'unifiedPassword', value: e.target.value })}
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
              ariaLabel="SSH public key"
              value={sshPublicKey}
              onChange={(e) => dispatchForm({ type: 'fieldChanged', name: 'sshPublicKey', value: e.target.value })}
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
                  { label: 'Duration', value: durationLabel(durationHours) },
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
                {stepContent()}
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
          onClose={() => dispatchVpnPrompt({ type: 'modalClosedWithConfig' })}
          isFirstTime
        />
      )}
    </>
  )
}

function CreatePageContent() {
  return useCreatePageContent()
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
