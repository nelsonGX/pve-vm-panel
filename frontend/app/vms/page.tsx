'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus } from 'lucide-react'
import { clientApiFetch } from '@/lib/api'
import VMCard, { type VM } from '@/components/VMCard'
import ConfirmDialog from '@/components/ConfirmDialog'
import Link from 'next/link'

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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60">
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2.5 text-left"
        >
          <ChevronRight
            className={`h-4 w-4 text-zinc-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="font-mono text-xs text-zinc-500">{shortId}</span>
          <span className="text-sm font-medium text-zinc-200">
            Bulk Group
          </span>
          <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
            {vms.length} VMs
          </span>
          {activeCount > 0 && (
            <span className="rounded-md border border-emerald-800/50 bg-emerald-950/50 px-2 py-0.5 text-xs text-emerald-400">
              {activeCount} active
            </span>
          )}
        </button>

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onDeleteGroup(bulkId)}
            className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-400 transition-all duration-150 hover:border-red-800 hover:bg-red-900/50 active:scale-95"
          >
            Delete All
          </button>
        )}
      </div>

      {/* VM grid */}
      {expanded && (
        <div className="border-t border-zinc-800 p-4">
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
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-indigo-500" />
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
        <div className="flex gap-2">
          <Link
            href="/create?bulk"
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 shadow-sm transition-all duration-150 hover:border-zinc-600 hover:bg-zinc-700 active:scale-95"
          >
            Bulk Create
          </Link>
          <Link
            href="/create"
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Create VM
          </Link>
        </div>
      </div>

      {error && (
        <div className="animate-fade-in mb-4 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {vms.length === 0 ? (
        <div className="animate-fade-in stagger-1 rounded-xl border border-zinc-800 bg-zinc-900/80 p-12 text-center">
          <p className="mb-5 text-zinc-400">You have no VMs yet.</p>
          <Link
            href="/create"
            className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-95"
          >
            Create your first VM
          </Link>
        </div>
      ) : (
        <>
          {hasActive && (
            <section className="animate-fade-in stagger-1 mb-6 flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Active ({activeVMs.length})
              </h2>

              {/* Bulk groups */}
              {Array.from(activeGroups.entries()).map(([bulkId, groupVms]) => (
                <BulkGroup
                  key={bulkId}
                  bulkId={bulkId}
                  vms={groupVms}
                  onDeleteGroup={setBulkDeleteTarget}
                  onDeleteVm={(id) => setDeleteTarget(id)}
                />
              ))}

              {/* Individual VMs */}
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
