'use client'

import { useEffect, useState, useCallback, useReducer } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import VMCard, { type VM } from '@/components/VMCard'
import ConfirmDialog from '@/components/ConfirmDialog'
import Link from 'next/link'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'
import Icon from '@/components/baseui/icon'
import { toast } from '@/components/baseui/toast-api'

interface BulkGroupProps {
  bulkId: string
  vms: VM[]
  onDeleteGroup: (bulkId: string) => void
  onActionGroup?: (bulkId: string, action: VMAction) => void
  onDeleteVm?: (id: string) => void
  onStartVm?: (id: string) => void
  onStopVm?: (id: string) => void
  onRestartVm?: (id: string) => void
  loadingAction?: VMAction | 'delete' | null
}

type VMAction = 'start' | 'stop' | 'restart'

interface VMsPageState {
  vms: VM[]
  loading: boolean
  error: string | null
  deleteTarget: string | null
  deleting: boolean
  bulkDeleteTarget: string | null
  bulkDeleting: boolean
  actionError: string | null
  vmActionLoading: { vmId: string; action: VMAction } | null
  bulkActionLoading: { bulkId: string; action: VMAction } | null
  showActive: boolean
  showStopped: boolean
  showPast: boolean
}

type VMsPageAction =
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; vms: VM[] }
  | { type: 'loadFailed'; error: string }
  | { type: 'deleteTargetChanged'; value: string | null }
  | { type: 'deleteStarted' }
  | { type: 'deleteSucceeded'; vmId: string }
  | { type: 'deleteFailed'; error: string }
  | { type: 'deleteFinished' }
  | { type: 'bulkDeleteTargetChanged'; value: string | null }
  | { type: 'bulkDeleteStarted' }
  | { type: 'bulkDeleteSucceeded'; bulkId: string }
  | { type: 'bulkDeleteFailed'; error: string }
  | { type: 'bulkDeleteFinished' }
  | { type: 'vmActionStarted'; vmId: string; action: VMAction }
  | { type: 'vmActionFailed'; error: string }
  | { type: 'vmActionFinished' }
  | { type: 'bulkActionStarted'; bulkId: string; action: VMAction }
  | { type: 'bulkActionFailed'; error: string }
  | { type: 'bulkActionFinished' }
  | { type: 'toggleFilter'; name: 'showActive' | 'showStopped' | 'showPast' }

const vmsPageInitialState: VMsPageState = {
  vms: [],
  loading: true,
  error: null,
  deleteTarget: null,
  deleting: false,
  bulkDeleteTarget: null,
  bulkDeleting: false,
  actionError: null,
  vmActionLoading: null,
  bulkActionLoading: null,
  showActive: true,
  showStopped: true,
  showPast: false,
}

function vmsPageReducer(state: VMsPageState, action: VMsPageAction): VMsPageState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, loading: true, error: null, actionError: null }
    case 'loadSucceeded':
      return { ...state, loading: false, vms: action.vms }
    case 'loadFailed':
      return { ...state, loading: false, error: action.error }
    case 'deleteTargetChanged':
      return { ...state, deleteTarget: action.value }
    case 'deleteStarted':
      return { ...state, deleting: true }
    case 'deleteSucceeded':
      return { ...state, vms: state.vms.filter((v) => v.id !== action.vmId) }
    case 'deleteFailed':
      return { ...state, error: action.error }
    case 'deleteFinished':
      return { ...state, deleting: false, deleteTarget: null }
    case 'bulkDeleteTargetChanged':
      return { ...state, bulkDeleteTarget: action.value }
    case 'bulkDeleteStarted':
      return { ...state, bulkDeleting: true }
    case 'bulkDeleteSucceeded':
      return {
        ...state,
        vms: state.vms.filter(
          (v) =>
            v.bulk_id !== action.bulkId ||
            (v.status !== 'running' && v.status !== 'provisioning'),
        ),
      }
    case 'bulkDeleteFailed':
      return { ...state, error: action.error }
    case 'bulkDeleteFinished':
      return { ...state, bulkDeleting: false, bulkDeleteTarget: null }
    case 'vmActionStarted':
      return {
        ...state,
        actionError: null,
        vmActionLoading: { vmId: action.vmId, action: action.action },
      }
    case 'vmActionFailed':
      return { ...state, actionError: action.error }
    case 'vmActionFinished':
      return { ...state, vmActionLoading: null }
    case 'bulkActionStarted':
      return {
        ...state,
        actionError: null,
        bulkActionLoading: { bulkId: action.bulkId, action: action.action },
      }
    case 'bulkActionFailed':
      return { ...state, actionError: action.error }
    case 'bulkActionFinished':
      return { ...state, bulkActionLoading: null }
    case 'toggleFilter':
      return { ...state, [action.name]: !state[action.name] }
  }
}

function BulkGroup({
  bulkId,
  vms,
  onDeleteGroup,
  onActionGroup,
  onDeleteVm,
  onStartVm,
  onStopVm,
  onRestartVm,
  loadingAction = null,
}: BulkGroupProps) {
  const [expanded, setExpanded] = useState(vms.length <= 6)

  const activeCount = vms.filter(
    (v) => v.status === 'running' || v.status === 'provisioning',
  ).length
  const runningCount = vms.filter((v) => v.status === 'running').length
  const stoppedCount = vms.filter((v) => v.status === 'stopped').length
  const manageableCount = activeCount + stoppedCount
  const shortId = bulkId.slice(0, 8)

  return (
    <PDiv fullWidth padding="p-0">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2.5 text-left"
        >
          <Icon name={expanded ? 'dropup' : 'dropdown'} size={14} color="#71717a" />
          <span className="font-mono text-xs text-zinc-500">{shortId}</span>
          <span className="text-sm font-medium text-zinc-200">Bulk Group</span>
          <span className="border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {vms.length} VMs
          </span>
          {activeCount > 0 && (
            <span className="border border-emerald-800 bg-emerald-950 px-2 py-0.5 text-xs text-emerald-400">
              {activeCount} active
            </span>
          )}
        </button>
        <div className="flex flex-wrap justify-end gap-2">
          {stoppedCount > 0 && onActionGroup && (
            <PButton
              variant="primary"
              customInnerClass="py-1"
              loading={loadingAction === 'start'}
              onClick={() => onActionGroup(bulkId, 'start')}
            >
              Start All
            </PButton>
          )}
          {runningCount > 0 && onActionGroup && (
            <PButton
              variant="secondary"
              customInnerClass="py-1"
              loading={loadingAction === 'stop'}
              onClick={() => onActionGroup(bulkId, 'stop')}
            >
              Stop All
            </PButton>
          )}
          {runningCount > 0 && onActionGroup && (
            <PButton
              variant="gray"
              customInnerClass="py-1"
              loading={loadingAction === 'restart'}
              onClick={() => onActionGroup(bulkId, 'restart')}
            >
              Restart All
            </PButton>
          )}
          {manageableCount > 0 && (
            <PButton
              variant="danger"
              customInnerClass="py-1"
              loading={loadingAction === 'delete'}
              onClick={() => onDeleteGroup(bulkId)}
            >
              Delete All
            </PButton>
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t-2 border-zinc-700 p-4">
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {vms.map((vm) => (
              <VMCard
                key={vm.id}
                vm={vm}
                onStart={onStartVm}
                onStop={onStopVm}
                onRestart={onRestartVm}
                loadingAction={null}
                onDelete={
                  onDeleteVm && (vm.status === 'running' || vm.status === 'provisioning' || vm.status === 'stopped')
                    ? (id) => onDeleteVm(id)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}
    </PDiv>
  )
}

function groupByBulk(list: VM[]) {
  const groups = new Map<string, VM[]>()
  const individuals: VM[] = []
  for (const vm of list) {
    if (vm.bulk_id) {
      const g = groups.get(vm.bulk_id) ?? []
      g.push(vm)
      groups.set(vm.bulk_id, g)
    } else {
      individuals.push(vm)
    }
  }
  return { groups, individuals }
}

interface VMsPageViewProps {
  vms: VM[]
  deleteTarget: string | null
  deleting: boolean
  bulkDeleteTarget: string | null
  bulkDeleting: boolean
  vmActionLoading: { vmId: string; action: VMAction } | null
  bulkActionLoading: { bulkId: string; action: VMAction } | null
  showActive: boolean
  showStopped: boolean
  showPast: boolean
  onToggleFilter: (name: 'showActive' | 'showStopped' | 'showPast') => void
  onDeleteTargetChange: (value: string | null) => void
  onBulkDeleteTargetChange: (value: string | null) => void
  onDeleteConfirm: () => void
  onBulkDeleteConfirm: () => void
  onVmAction: (vmId: string, action: VMAction) => void
  onBulkAction: (bulkId: string, action: VMAction) => void
}

function VMsPageView({
  vms,
  deleteTarget,
  deleting,
  bulkDeleteTarget,
  bulkDeleting,
  vmActionLoading,
  bulkActionLoading,
  showActive,
  showStopped,
  showPast,
  onToggleFilter,
  onDeleteTargetChange,
  onBulkDeleteTargetChange,
  onDeleteConfirm,
  onBulkDeleteConfirm,
  onVmAction,
  onBulkAction,
}: VMsPageViewProps) {
  const activeVMs = vms.filter((v) => v.status === 'running' || v.status === 'provisioning')
  const stoppedVMs = vms.filter((v) => v.status === 'stopped')
  const inactiveVMs = vms.filter(
    (v) => v.status !== 'running' && v.status !== 'provisioning' && v.status !== 'stopped',
  )

  const { groups: activeGroups, individuals: activeIndividuals } = groupByBulk(activeVMs)
  const { groups: stoppedGroups, individuals: stoppedIndividuals } = groupByBulk(stoppedVMs)
  const { groups: inactiveGroups, individuals: inactiveIndividuals } = groupByBulk(inactiveVMs)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <VMsHeader />
      <VMFilters
        counts={{
          total: vms.length,
          active: activeVMs.length,
          stopped: stoppedVMs.length,
          inactive: inactiveVMs.length,
        }}
        visibility={{ active: showActive, stopped: showStopped, past: showPast }}
        onToggleFilter={onToggleFilter}
      />

      {vms.length === 0 ? (
        <EmptyVMsState />
      ) : (
        <VMsList
          activeVMs={activeVMs}
          stoppedVMs={stoppedVMs}
          inactiveVMs={inactiveVMs}
          activeGroups={activeGroups}
          activeIndividuals={activeIndividuals}
          stoppedGroups={stoppedGroups}
          stoppedIndividuals={stoppedIndividuals}
          inactiveGroups={inactiveGroups}
          inactiveIndividuals={inactiveIndividuals}
          showActive={showActive}
          showStopped={showStopped}
          showPast={showPast}
          vmActionLoading={vmActionLoading}
          bulkActionLoading={bulkActionLoading}
          onDeleteTargetChange={onDeleteTargetChange}
          onBulkDeleteTargetChange={onBulkDeleteTargetChange}
          onVmAction={onVmAction}
          onBulkAction={onBulkAction}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete VM"
        message="Are you sure you want to delete this VM? This action cannot be undone."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        confirmLoading={deleting}
        danger
        onConfirm={onDeleteConfirm}
        onCancel={() => onDeleteTargetChange(null)}
      />
      <ConfirmDialog
        open={!!bulkDeleteTarget}
        title="Delete Bulk Group"
        message="Delete all running, provisioning, or stopped VMs in this bulk group? This cannot be undone."
        confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete All'}
        confirmLoading={bulkDeleting}
        danger
        onConfirm={onBulkDeleteConfirm}
        onCancel={() => onBulkDeleteTargetChange(null)}
      />
    </div>
  )
}

function VMsHeader() {
  return (
    <div className="animate-fade-in mb-6 flex items-center justify-between">
      <h1 className="text-2xl font-bold text-zinc-100">My VMs</h1>
      <div className="flex gap-3">
        <Link href="/create?bulk">
          <PButton variant="secondary">Bulk Create</PButton>
        </Link>
        <Link href="/create">
          <PButton variant="primary">+ Create VM</PButton>
        </Link>
      </div>
    </div>
  )
}

function VMFilters({
  counts,
  visibility,
  onToggleFilter,
}: {
  counts: {
    total: number
    active: number
    stopped: number
    inactive: number
  }
  visibility: {
    active: boolean
    stopped: boolean
    past: boolean
  }
  onToggleFilter: (name: 'showActive' | 'showStopped' | 'showPast') => void
}) {
  if (counts.total === 0) return null

  return (
    <div className="animate-fade-in mb-5 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onToggleFilter('showActive')}
        className={`border px-3 py-1 text-xs font-medium transition-colors ${visibility.active ? 'border-emerald-700 bg-emerald-950 text-emerald-400' : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
      >
        Active ({counts.active})
      </button>
      <button
        type="button"
        onClick={() => onToggleFilter('showStopped')}
        className={`border px-3 py-1 text-xs font-medium transition-colors ${visibility.stopped ? 'border-zinc-600 bg-zinc-800 text-zinc-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
      >
        Stopped ({counts.stopped})
      </button>
      {counts.inactive > 0 && (
        <button
          type="button"
          onClick={() => onToggleFilter('showPast')}
          className={`border px-3 py-1 text-xs font-medium transition-colors ${visibility.past ? 'border-zinc-600 bg-zinc-800 text-zinc-300' : 'border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
        >
          Past ({counts.inactive})
        </button>
      )}
    </div>
  )
}

function EmptyVMsState() {
  return (
    <PDiv fullWidth padding="p-12" className="animate-fade-in stagger-1">
      <div className="text-center">
        <p className="mb-5 text-zinc-400">You have no VMs yet.</p>
        <Link href="/create">
          <PDiv animated shadowColor="blue-700" borderColor="blue-400" padding="px-5 py-2">
            <span className="text-sm font-medium text-blue-200">Create your first VM</span>
          </PDiv>
        </Link>
      </div>
    </PDiv>
  )
}

function VMsList({
  activeVMs,
  stoppedVMs,
  inactiveVMs,
  activeGroups,
  activeIndividuals,
  stoppedGroups,
  stoppedIndividuals,
  inactiveGroups,
  inactiveIndividuals,
  showActive,
  showStopped,
  showPast,
  vmActionLoading,
  bulkActionLoading,
  onDeleteTargetChange,
  onBulkDeleteTargetChange,
  onVmAction,
  onBulkAction,
}: {
  activeVMs: VM[]
  stoppedVMs: VM[]
  inactiveVMs: VM[]
  activeGroups: Map<string, VM[]>
  activeIndividuals: VM[]
  stoppedGroups: Map<string, VM[]>
  stoppedIndividuals: VM[]
  inactiveGroups: Map<string, VM[]>
  inactiveIndividuals: VM[]
  showActive: boolean
  showStopped: boolean
  showPast: boolean
  vmActionLoading: { vmId: string; action: VMAction } | null
  bulkActionLoading: { bulkId: string; action: VMAction } | null
  onDeleteTargetChange: (value: string | null) => void
  onBulkDeleteTargetChange: (value: string | null) => void
  onVmAction: (vmId: string, action: VMAction) => void
  onBulkAction: (bulkId: string, action: VMAction) => void
}) {
  const hasVisibleSection =
    (activeVMs.length > 0 && showActive) ||
    (stoppedVMs.length > 0 && showStopped) ||
    (inactiveVMs.length > 0 && showPast)

  return (
    <>
      {activeVMs.length > 0 && showActive && (
        <VMSection
          title="Active"
          staggerClass="stagger-1"
          vms={activeVMs}
          groups={activeGroups}
          individuals={activeIndividuals}
          bulkActionLoading={bulkActionLoading}
          vmActionLoading={vmActionLoading}
          onDeleteGroup={onBulkDeleteTargetChange}
          onActionGroup={onBulkAction}
          onDeleteVm={onDeleteTargetChange}
          onStopVm={(id) => onVmAction(id, 'stop')}
          onRestartVm={(id) => onVmAction(id, 'restart')}
        />
      )}

      {stoppedVMs.length > 0 && showStopped && (
        <VMSection
          title="Stopped"
          staggerClass="stagger-2"
          vms={stoppedVMs}
          groups={stoppedGroups}
          individuals={stoppedIndividuals}
          bulkActionLoading={bulkActionLoading}
          vmActionLoading={vmActionLoading}
          onDeleteGroup={onBulkDeleteTargetChange}
          onActionGroup={onBulkAction}
          onDeleteVm={onDeleteTargetChange}
          onStartVm={(id) => onVmAction(id, 'start')}
        />
      )}

      {inactiveVMs.length > 0 && showPast && (
        <VMSection
          title="Past"
          staggerClass="stagger-3"
          vms={inactiveVMs}
          groups={inactiveGroups}
          individuals={inactiveIndividuals}
          onDeleteGroup={onBulkDeleteTargetChange}
        />
      )}

      {!hasVisibleSection && (
        <PDiv fullWidth padding="p-12" className="animate-fade-in">
          <p className="text-center text-zinc-600">Nothing to display.</p>
        </PDiv>
      )}
    </>
  )
}

function VMSection({
  title,
  staggerClass,
  vms,
  groups,
  individuals,
  bulkActionLoading = null,
  vmActionLoading = null,
  onDeleteGroup,
  onActionGroup,
  onDeleteVm,
  onStartVm,
  onStopVm,
  onRestartVm,
}: {
  title: string
  staggerClass: string
  vms: VM[]
  groups: Map<string, VM[]>
  individuals: VM[]
  bulkActionLoading?: { bulkId: string; action: VMAction } | null
  vmActionLoading?: { vmId: string; action: VMAction } | null
  onDeleteGroup: (bulkId: string) => void
  onActionGroup?: (bulkId: string, action: VMAction) => void
  onDeleteVm?: (id: string) => void
  onStartVm?: (id: string) => void
  onStopVm?: (id: string) => void
  onRestartVm?: (id: string) => void
}) {
  return (
    <section className={`animate-fade-in ${staggerClass} mb-6 flex flex-col gap-4`}>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {title} ({vms.length})
      </h2>
      {Array.from(groups.entries()).map(([bulkId, groupVms]) => (
        <BulkGroup
          key={bulkId}
          bulkId={bulkId}
          vms={groupVms}
          onDeleteGroup={onDeleteGroup}
          onActionGroup={onActionGroup}
          onDeleteVm={onDeleteVm}
          onStartVm={onStartVm}
          onStopVm={onStopVm}
          onRestartVm={onRestartVm}
          loadingAction={bulkActionLoading?.bulkId === bulkId ? bulkActionLoading.action : null}
        />
      ))}
      {individuals.length > 0 && (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {individuals.map((vm) => (
            <VMCard
              key={vm.id}
              vm={vm}
              onStart={onStartVm}
              onStop={onStopVm}
              onRestart={onRestartVm}
              onDelete={onDeleteVm}
              loadingAction={vmActionLoading?.vmId === vm.id ? vmActionLoading.action : null}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default function VMsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [state, dispatch] = useReducer(vmsPageReducer, vmsPageInitialState)
  const {
    vms,
    loading,
    error,
    deleteTarget,
    deleting,
    bulkDeleteTarget,
    bulkDeleting,
    actionError,
    vmActionLoading,
    bulkActionLoading,
    showActive,
    showStopped,
    showPast,
  } = state

  const fetchVMs = useCallback(async () => {
    dispatch({ type: 'loadStarted' })
    try {
      const data = await clientApiFetch('/vms')
      dispatch({ type: 'loadSucceeded', vms: data as VM[] })
    } catch (err) {
      dispatch({
        type: 'loadFailed',
        error: err instanceof Error ? err.message : 'Failed to load VMs',
      })
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') fetchVMs()
  }, [status, fetchVMs])

  useEffect(() => {
    if (error) {
      toast.error(error, { autoClose: false })
    }
  }, [error])

  useEffect(() => {
    if (actionError) {
      toast.warning(actionError, { autoClose: false })
    }
  }, [actionError])

  if (status === 'loading' || loading) {
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

  async function handleDelete() {
    if (!deleteTarget) return
    const vm = vms.find((v) => v.id === deleteTarget)
    dispatch({ type: 'deleteStarted' })
    try {
      await clientApiFetch(`/vms/${deleteTarget}`, { method: 'DELETE' })
      dispatch({ type: 'deleteSucceeded', vmId: deleteTarget })
      toast.success(vm ? `${vm.name} deleted.` : 'VM deleted.')
    } catch (err) {
      dispatch({
        type: 'deleteFailed',
        error: err instanceof Error ? err.message : 'Failed to delete VM',
      })
    } finally {
      dispatch({ type: 'deleteFinished' })
    }
  }

  async function handleBulkDelete() {
    if (!bulkDeleteTarget) return
    const groupVms = vms.filter((v) => v.bulk_id === bulkDeleteTarget)
    dispatch({ type: 'bulkDeleteStarted' })
    try {
      await clientApiFetch(`/vms/bulk/${bulkDeleteTarget}`, { method: 'DELETE' })
      dispatch({ type: 'bulkDeleteSucceeded', bulkId: bulkDeleteTarget })
      toast.success(`Deleted ${groupVms.length} VMs.`)
    } catch (err) {
      dispatch({
        type: 'bulkDeleteFailed',
        error: err instanceof Error ? err.message : 'Failed to delete bulk VMs',
      })
    } finally {
      dispatch({ type: 'bulkDeleteFinished' })
    }
  }

  async function handleVmAction(vmId: string, action: VMAction) {
    dispatch({ type: 'vmActionStarted', vmId, action })
    const vm = vms.find((v) => v.id === vmId)
    try {
      await clientApiFetch(`/vms/${vmId}/${action}`, { method: 'POST' })
      await fetchVMs()
      const label = action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted'
      toast.success(vm ? `${vm.name} ${label}.` : `VM ${label}.`)
    } catch (err) {
      dispatch({
        type: 'vmActionFailed',
        error: err instanceof Error ? err.message : `Failed to ${action} VM`,
      })
    } finally {
      dispatch({ type: 'vmActionFinished' })
    }
  }

  async function handleBulkAction(bulkId: string, action: VMAction) {
    dispatch({ type: 'bulkActionStarted', bulkId, action })
    const groupVms = vms.filter((v) => v.bulk_id === bulkId)
    try {
      await clientApiFetch(`/vms/bulk/${bulkId}/${action}`, { method: 'POST' })
      await fetchVMs()
      const label = action === 'start' ? 'started' : action === 'stop' ? 'stopped' : 'restarted'
      toast.success(`${groupVms.length} VMs ${label}.`)
    } catch (err) {
      dispatch({
        type: 'bulkActionFailed',
        error: err instanceof Error ? err.message : `Failed to ${action} bulk VMs`,
      })
    } finally {
      dispatch({ type: 'bulkActionFinished' })
    }
  }

  return (
    <VMsPageView
      vms={vms}
      deleteTarget={deleteTarget}
      deleting={deleting}
      bulkDeleteTarget={bulkDeleteTarget}
      bulkDeleting={bulkDeleting}
      vmActionLoading={vmActionLoading}
      bulkActionLoading={bulkActionLoading}
      showActive={showActive}
      showStopped={showStopped}
      showPast={showPast}
      onToggleFilter={(name) => dispatch({ type: 'toggleFilter', name })}
      onDeleteTargetChange={(value) => dispatch({ type: 'deleteTargetChanged', value })}
      onBulkDeleteTargetChange={(value) => dispatch({ type: 'bulkDeleteTargetChanged', value })}
      onDeleteConfirm={handleDelete}
      onBulkDeleteConfirm={handleBulkDelete}
      onVmAction={handleVmAction}
      onBulkAction={handleBulkAction}
    />
  )
}
