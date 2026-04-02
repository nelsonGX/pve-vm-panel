'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import VMCard, { type VM } from '@/components/VMCard'
import ConfirmDialog from '@/components/ConfirmDialog'
import Link from 'next/link'
import PButton from '@/components/baseui/pbutton'
import PixelSpinner from '@/components/baseui/spinner'
import Icon from '@/components/baseui/icon'

// ---------------------------------------------------------------------------
// Bulk group component
// ---------------------------------------------------------------------------
interface BulkGroupProps {
  bulkId: string
  vms: VM[]
  onDeleteGroup: (bulkId: string) => void
  onDeleteVm?: (id: string) => void
}

function BulkGroup({ bulkId, vms, onDeleteGroup, onDeleteVm }: BulkGroupProps) {
  const [expanded, setExpanded] = useState(vms.length <= 6)

  const activeCount = vms.filter(
    (v) => v.status === 'running' || v.status === 'provisioning',
  ).length
  const shortId = bulkId.slice(0, 8)

  return (
    <div className="border-b-4 border-r-4 border-zinc-600 bg-zinc-600 w-full pixel-panel-outer">
      <div className="border-4 border-zinc-400 bg-zinc-900/85 w-full pixel-panel-inner">
        {/* Group header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex flex-1 items-center gap-2.5 text-left"
          >
            <Icon name={expanded ? 'dropup' : 'dropdown'} size={14} color="#71717a" />
            <span className="font-mono text-xs text-zinc-500">{shortId}</span>
            <span className="text-sm font-medium text-zinc-200">
              Bulk Group
            </span>
            <span className="border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              {vms.length} VMs
            </span>
            {activeCount > 0 && (
              <span className="border border-emerald-800 bg-emerald-950 px-2 py-0.5 text-xs text-emerald-400">
                {activeCount} active
              </span>
            )}
          </button>

          {activeCount > 0 && (
            <PButton
              variant="danger"
              customInnerClass="py-1"
              onClick={() => onDeleteGroup(bulkId)}
            >
              Delete All
            </PButton>
          )}
        </div>

        {/* VM grid */}
        {expanded && (
          <div className="border-t-2 border-zinc-700 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {vms.map((vm) => (
                <VMCard
                  key={vm.id}
                  vm={vm}
                  onDelete={
                    onDeleteVm && (vm.status === 'running' || vm.status === 'provisioning')
                      ? (id) => onDeleteVm(id)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
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

  const fetchVMs = useCallback(async () => {
    setLoading(true)
    setError(null)
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
          (v) =>
            v.bulk_id !== bulkDeleteTarget ||
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

  // ---------------------------------------------------------------------------
  // Grouping logic
  // ---------------------------------------------------------------------------
  const activeVMs = vms.filter(
    (v) => v.status === 'running' || v.status === 'provisioning',
  )
  const inactiveVMs = vms.filter(
    (v) => v.status !== 'running' && v.status !== 'provisioning',
  )

  function groupByBulk(list: VM[]): {
    groups: Map<string, VM[]>
    individuals: VM[]
  } {
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
  const { groups: inactiveGroups, individuals: inactiveIndividuals } = groupByBulk(inactiveVMs)

  const hasActive = activeVMs.length > 0
  const hasInactive = inactiveVMs.length > 0

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="animate-fade-in mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">My VMs</h1>
        <div className="flex gap-3">
          <Link href="/create?bulk">
            <PButton variant="secondary">Bulk Create</PButton>
          </Link>
          <Link href="/create">
            <PButton variant="primary">
              + Create VM
            </PButton>
          </Link>
        </div>
      </div>

      {error && (
        <div className="animate-fade-in mb-4 border-b-2 border-r-2 border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {vms.length === 0 ? (
        <div className="animate-fade-in stagger-1 border-b-4 border-r-4 border-zinc-600 bg-zinc-600 w-full pixel-panel-outer">
          <div className="border-4 border-zinc-400 bg-zinc-900/85 w-full pixel-panel-inner p-12 text-center">
            <p className="mb-5 text-zinc-400">You have no VMs yet.</p>
            <Link href="/create">
              <div className="inline-block border-b-4 border-r-4 border-indigo-700 bg-indigo-700 pixel-panel-outer hover:border-b-6 hover:border-r-6 hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-75 ease-in">
                <div className="border-4 border-indigo-400 bg-zinc-900/85 pixel-panel-inner px-5 py-2 text-sm font-medium text-indigo-200">
                  Create your first VM
                </div>
              </div>
            </Link>
          </div>
        </div>
      ) : (
        <>
          {hasActive && (
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
                  onDeleteVm={(id) => setDeleteTarget(id)}
                />
              ))}

              {activeIndividuals.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {activeIndividuals.map((vm) => (
                    <VMCard
                      key={vm.id}
                      vm={vm}
                      onDelete={(id) => setDeleteTarget(id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {hasInactive && (
            <section className="animate-fade-in stagger-2 flex flex-col gap-4">
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
                <div className="grid gap-4 sm:grid-cols-2">
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
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!bulkDeleteTarget}
        title="Delete Bulk Group"
        message={`Delete all active VMs in this bulk group? This cannot be undone.`}
        confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete All'}
        danger
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDeleteTarget(null)}
      />
    </div>
  )
}
