'use client'

import { useEffect, useState, useCallback } from 'react'
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

export default function VMsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [vms, setVms] = useState<VM[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [vmActionLoading, setVmActionLoading] = useState<{ vmId: string; action: VMAction } | null>(null)
  const [bulkActionLoading, setBulkActionLoading] = useState<{ bulkId: string; action: VMAction } | null>(null)

  const fetchVMs = useCallback(async () => {
    setLoading(true)
    setError(null)
    setActionError(null)
    try {
      const data = await clientApiFetch('/vms')
      setVms(data as VM[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VMs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'authenticated') fetchVMs()
  }, [status, fetchVMs])

  if (status === 'loading' || loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelSpinner color="bg-indigo-400" size={10} />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    router.replace('/login')
    return null
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await clientApiFetch(`/vms/${deleteTarget}`, { method: 'DELETE' })
      setVms((prev) => prev.filter((v) => v.id !== deleteTarget))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete VM')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  async function handleBulkDelete() {
    if (!bulkDeleteTarget) return
    setBulkDeleting(true)
    try {
      await clientApiFetch(`/vms/bulk/${bulkDeleteTarget}`, { method: 'DELETE' })
      setVms((prev) =>
        prev.filter(
          (v) => v.bulk_id !== bulkDeleteTarget ||
            (v.status !== 'running' && v.status !== 'provisioning'),
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bulk VMs')
    } finally {
      setBulkDeleting(false)
      setBulkDeleteTarget(null)
    }
  }

  async function handleVmAction(vmId: string, action: VMAction) {
    setActionError(null)
    setVmActionLoading({ vmId, action })
    try {
      await clientApiFetch(`/vms/${vmId}/${action}`, { method: 'POST' })
      await fetchVMs()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${action} VM`)
    } finally {
      setVmActionLoading(null)
    }
  }

  async function handleBulkAction(bulkId: string, action: VMAction) {
    setActionError(null)
    setBulkActionLoading({ bulkId, action })
    try {
      await clientApiFetch(`/vms/bulk/${bulkId}/${action}`, { method: 'POST' })
      await fetchVMs()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${action} bulk VMs`)
    } finally {
      setBulkActionLoading(null)
    }
  }

  const activeVMs = vms.filter((v) => v.status === 'running' || v.status === 'provisioning')
  const stoppedVMs = vms.filter((v) => v.status === 'stopped')
  const inactiveVMs = vms.filter(
    (v) => v.status !== 'running' && v.status !== 'provisioning' && v.status !== 'stopped',
  )

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

  const { groups: activeGroups, individuals: activeIndividuals } = groupByBulk(activeVMs)
  const { groups: stoppedGroups, individuals: stoppedIndividuals } = groupByBulk(stoppedVMs)
  const { groups: inactiveGroups, individuals: inactiveIndividuals } = groupByBulk(inactiveVMs)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
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

      {error && (
        <div className="animate-fade-in mb-4 border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {actionError && (
        <div className="animate-fade-in mb-4 border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          {actionError}
        </div>
      )}

      {vms.length === 0 ? (
        <PDiv fullWidth padding="p-12" className="animate-fade-in stagger-1">
          <div className="text-center">
            <p className="mb-5 text-zinc-400">You have no VMs yet.</p>
            <Link href="/create">
              <PDiv animated shadowColor="indigo-700" borderColor="indigo-400" padding="px-5 py-2">
                <span className="text-sm font-medium text-indigo-200">Create your first VM</span>
              </PDiv>
            </Link>
          </div>
        </PDiv>
      ) : (
        <>
          {activeVMs.length > 0 && (
            <section className="animate-fade-in stagger-1 mb-6 flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Active ({activeVMs.length})
              </h2>
              {Array.from(activeGroups.entries()).map(([bulkId, groupVms]) => (
                <BulkGroup
                  key={bulkId}
                  bulkId={bulkId}
                  vms={groupVms}
                  onDeleteGroup={setBulkDeleteTarget}
                  onActionGroup={handleBulkAction}
                  onDeleteVm={(id) => setDeleteTarget(id)}
                  onStopVm={(id) => handleVmAction(id, 'stop')}
                  onRestartVm={(id) => handleVmAction(id, 'restart')}
                  loadingAction={bulkActionLoading?.bulkId === bulkId ? bulkActionLoading.action : null}
                />
              ))}
              {activeIndividuals.length > 0 && (
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  {activeIndividuals.map((vm) => (
                    <VMCard
                      key={vm.id}
                      vm={vm}
                      onStop={(id) => handleVmAction(id, 'stop')}
                      onRestart={(id) => handleVmAction(id, 'restart')}
                      onDelete={(id) => setDeleteTarget(id)}
                      loadingAction={vmActionLoading?.vmId === vm.id ? vmActionLoading.action : null}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {stoppedVMs.length > 0 && (
            <section className="animate-fade-in stagger-2 mb-6 flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Stopped ({stoppedVMs.length})
              </h2>
              {Array.from(stoppedGroups.entries()).map(([bulkId, groupVms]) => (
                <BulkGroup
                  key={bulkId}
                  bulkId={bulkId}
                  vms={groupVms}
                  onDeleteGroup={setBulkDeleteTarget}
                  onActionGroup={handleBulkAction}
                  onDeleteVm={(id) => setDeleteTarget(id)}
                  onStartVm={(id) => handleVmAction(id, 'start')}
                  loadingAction={bulkActionLoading?.bulkId === bulkId ? bulkActionLoading.action : null}
                />
              ))}
              {stoppedIndividuals.length > 0 && (
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  {stoppedIndividuals.map((vm) => (
                    <VMCard
                      key={vm.id}
                      vm={vm}
                      onStart={(id) => handleVmAction(id, 'start')}
                      onDelete={(id) => setDeleteTarget(id)}
                      loadingAction={vmActionLoading?.vmId === vm.id ? vmActionLoading.action : null}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {inactiveVMs.length > 0 && (
            <section className="animate-fade-in stagger-3 flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Past ({inactiveVMs.length})
              </h2>
              {Array.from(inactiveGroups.entries()).map(([bulkId, groupVms]) => (
                <BulkGroup
                  key={bulkId}
                  bulkId={bulkId}
                  vms={groupVms}
                  onDeleteGroup={setBulkDeleteTarget}
                />
              ))}
              {inactiveIndividuals.length > 0 && (
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  {inactiveIndividuals.map((vm) => (
                    <VMCard key={vm.id} vm={vm} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete VM"
        message="Are you sure you want to delete this VM? This action cannot be undone."
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        confirmLoading={deleting}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDialog
        open={!!bulkDeleteTarget}
        title="Delete Bulk Group"
        message="Delete all running, provisioning, or stopped VMs in this bulk group? This cannot be undone."
        confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete All'}
        confirmLoading={bulkDeleting}
        danger
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteTarget(null)}
      />
    </div>
  )
}
