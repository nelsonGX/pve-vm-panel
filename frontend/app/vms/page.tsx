'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import VMCard, { type VM } from '@/components/VMCard'
import ConfirmDialog from '@/components/ConfirmDialog'
import Link from 'next/link'

export default function VMsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [vms, setVms] = useState<VM[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  const activeVMs = vms.filter(
    (v) => v.status === 'running' || v.status === 'provisioning',
  )
  const inactiveVMs = vms.filter(
    (v) => v.status !== 'running' && v.status !== 'provisioning',
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="animate-fade-in mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">My VMs</h1>
        <Link
          href="/create"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-900/40 transition-all duration-150 hover:bg-indigo-500 active:scale-95"
        >
          + Create VM
        </Link>
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
          {activeVMs.length > 0 && (
            <section className="animate-fade-in stagger-1 mb-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Active ({activeVMs.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {activeVMs.map((vm) => (
                  <VMCard
                    key={vm.id}
                    vm={vm}
                    onDelete={(id) => setDeleteTarget(id)}
                  />
                ))}
              </div>
            </section>
          )}

          {inactiveVMs.length > 0 && (
            <section className="animate-fade-in stagger-2">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Past ({inactiveVMs.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {inactiveVMs.map((vm) => (
                  <VMCard key={vm.id} vm={vm} />
                ))}
              </div>
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
    </div>
  )
}
