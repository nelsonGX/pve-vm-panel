'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { clientApiFetch } from '@/lib/api'
import ConfirmDialog from '@/components/ConfirmDialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Code {
  id: string
  code: string
  points_value: number
  max_uses: number
  current_uses: number
  created_at: string
  expires_at?: string
  is_active: boolean
}

interface AdminVM {
  vm_id: string
  vmid: number
  user_id: string
  os: string
  cpu_cores: number
  ram_gb: number
  disk_gb: number
  ip_address?: string
  username?: string
  status: string
  expires_at: string
  points_charged: number
}

interface AdminUser {
  id: string
  discord_id: string
  discord_username: string
  points: number
  created_at: string
}

type Tab = 'codes' | 'vms' | 'users'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function CodesTab() {
  const [codes, setCodes] = useState<Code[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  // Create form
  const [newPoints, setNewPoints] = useState(100)
  const [newMaxUses, setNewMaxUses] = useState(1)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const loadCodes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await clientApiFetch('/admin/codes')
      setCodes((data as { items: Code[] }).items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load codes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCodes() }, [loadCodes])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      await clientApiFetch('/admin/codes', {
        method: 'POST',
        body: JSON.stringify({ points_value: newPoints, max_uses: newMaxUses }),
      })
      await loadCodes()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create code')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await clientApiFetch(`/admin/codes/${deleteTarget}`, { method: 'DELETE' })
      setCodes((prev) => prev.filter((c) => c.id !== deleteTarget))
    } catch {
      await loadCodes()
    } finally {
      setDeleteTarget(null)
    }
  }

  if (loading) return <div className="py-8 text-center text-zinc-500">Loading codes...</div>
  if (error) return <div className="py-8 text-center text-red-400">{error}</div>

  return (
    <div className="animate-fade-in">
      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/80 p-5"
      >
        <h3 className="mb-4 text-sm font-semibold text-zinc-200">Create Code</h3>
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">Points</label>
            <input
              type="number"
              value={newPoints}
              min={1}
              onChange={(e) => setNewPoints(parseInt(e.target.value) || 1)}
              className="w-28 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-500">Max Uses</label>
            <input
              type="number"
              value={newMaxUses}
              min={1}
              onChange={(e) => setNewMaxUses(parseInt(e.target.value) || 1)}
              className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-all duration-150 hover:bg-indigo-500 active:scale-95 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
        {createError && (
          <p className="mt-2 text-xs text-red-400">{createError}</p>
        )}
      </form>

      {/* Code list */}
      {codes.length === 0 ? (
        <p className="text-sm text-zinc-500">No codes yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-800/80">
              <tr>
                {['Code', 'Points', 'Uses', 'Expires', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-t border-zinc-800 bg-zinc-900/60 transition-colors hover:bg-zinc-800/40">
                  <td className="px-4 py-2.5 font-mono text-zinc-200">{c.code}</td>
                  <td className="px-4 py-2.5 text-zinc-300">{c.points_value.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    {c.current_uses} / {c.max_uses}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => setDeleteTarget(c.id)}
                      className="rounded-md border border-red-900/50 bg-red-950/40 px-2 py-1 text-xs text-red-400 transition-all duration-150 hover:border-red-800 hover:bg-red-900/50 active:scale-95"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Code"
        message="Delete this redemption code? Existing users who have redeemed it keep their points."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function VMsTab() {
  const [vms, setVMs] = useState<AdminVM[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const loadVMs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await clientApiFetch('/admin/vms')
      setVMs((data as { items: AdminVM[] }).items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VMs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadVMs() }, [loadVMs])

  async function handleForceDelete() {
    if (!deleteTarget) return
    try {
      await clientApiFetch(`/admin/vms/${deleteTarget}`, { method: 'DELETE' })
      setVMs((prev) => prev.filter((v) => v.vm_id !== deleteTarget))
    } catch {
      await loadVMs()
    } finally {
      setDeleteTarget(null)
    }
  }

  if (loading) return <div className="py-8 text-center text-zinc-500">Loading VMs...</div>
  if (error) return <div className="py-8 text-center text-red-400">{error}</div>

  if (vms.length === 0) {
    return <p className="text-sm text-zinc-500">No active VMs.</p>
  }

  const STATUS_STYLES: Record<string, string> = {
    running: 'border-emerald-800/50 bg-emerald-950/50 text-emerald-400',
    provisioning: 'border-amber-800/50 bg-amber-950/50 text-amber-400',
    error: 'border-red-800/50 bg-red-950/50 text-red-400',
    expired: 'border-zinc-700/50 bg-zinc-800/50 text-zinc-500',
  }

  return (
    <div className="animate-fade-in">
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/80">
            <tr>
              {['VM', 'Owner', 'Specs', 'IP', 'Status', 'Expires', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vms.map((vm) => (
              <tr key={vm.vm_id} className="border-t border-zinc-800 bg-zinc-900/60 transition-colors hover:bg-zinc-800/40">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-zinc-200">{vm.username ?? vm.vm_id}</p>
                  <p className="text-xs text-zinc-500">{vm.os}</p>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">{vm.user_id}</td>
                <td className="px-4 py-2.5 text-zinc-400">
                  {vm.cpu_cores}C / {vm.ram_gb}GB / {vm.disk_gb}GB
                </td>
                <td className="px-4 py-2.5 font-mono text-zinc-300">{vm.ip_address ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[vm.status] ?? 'border-zinc-700/50 bg-zinc-800/50 text-zinc-500'}`}>
                    {vm.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">
                  {new Date(vm.expires_at).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => setDeleteTarget(vm.vm_id)}
                    className="rounded-md border border-red-900/50 bg-red-950/40 px-2 py-1 text-xs text-red-400 transition-all duration-150 hover:border-red-800 hover:bg-red-900/50 active:scale-95"
                  >
                    Force Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Force Delete VM"
        message="Force-delete this VM immediately? The owner will not be refunded."
        confirmLabel="Force Delete"
        danger
        onConfirm={handleForceDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null)
  const [adjustDelta, setAdjustDelta] = useState(0)
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await clientApiFetch('/admin/users')
      setUsers((data as { items: AdminUser[] }).items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault()
    if (!adjustTarget || adjustDelta === 0) return
    setAdjusting(true)
    setAdjustError(null)
    try {
      await clientApiFetch(`/admin/users/${adjustTarget}/adjust-points`, {
        method: 'POST',
        body: JSON.stringify({ delta: adjustDelta, reason: adjustReason }),
      })
      setAdjustTarget(null)
      setAdjustDelta(0)
      setAdjustReason('')
      await loadUsers()
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Failed to adjust points')
    } finally {
      setAdjusting(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-zinc-500">Loading users...</div>
  if (error) return <div className="py-8 text-center text-red-400">{error}</div>

  return (
    <div className="animate-fade-in">
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800/80">
            <tr>
              {['User', 'Discord ID', 'Points', 'Joined', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.discord_id} className="border-t border-zinc-800 bg-zinc-900/60 transition-colors hover:bg-zinc-800/40">
                <td className="px-4 py-2.5 font-medium text-zinc-200">{u.discord_username}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-600">{u.discord_id}</td>
                <td className="px-4 py-2.5 font-medium text-indigo-300">{u.points.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2.5">
                  {adjustTarget === u.discord_id ? (
                    <form onSubmit={handleAdjust} className="flex flex-col gap-1.5 min-w-[220px]">
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          value={adjustDelta}
                          onChange={(e) => setAdjustDelta(parseInt(e.target.value) || 0)}
                          placeholder="±points"
                          className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                        />
                        <input
                          type="text"
                          value={adjustReason}
                          onChange={(e) => setAdjustReason(e.target.value)}
                          placeholder="Reason"
                          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      {adjustError && <p className="text-xs text-red-400">{adjustError}</p>}
                      <div className="flex gap-1.5">
                        <button
                          type="submit"
                          disabled={adjusting || adjustDelta === 0}
                          className="rounded-lg bg-indigo-600 px-2 py-1 text-xs text-white transition-all hover:bg-indigo-500 active:scale-95 disabled:opacity-50"
                        >
                          {adjusting ? '...' : 'Apply'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAdjustTarget(null); setAdjustError(null) }}
                          className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-all hover:bg-zinc-700 active:scale-95"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      onClick={() => { setAdjustTarget(u.discord_id); setAdjustDelta(0); setAdjustReason('') }}
                      className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-all hover:border-zinc-600 hover:bg-zinc-700 active:scale-95"
                    >
                      Adjust Points
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Admin Page
// ---------------------------------------------------------------------------
export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('codes')
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
      return
    }
    if (status === 'authenticated') {
      clientApiFetch('/admin/check')
        .catch(() => setForbidden(true))
    }
  }, [status, router])

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-indigo-500" />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="rounded-xl border border-red-800/60 bg-red-950/30 p-8 text-center">
          <p className="text-xl font-bold text-red-400">403 Forbidden</p>
          <p className="mt-2 text-sm text-zinc-400">
            You do not have admin access.
          </p>
        </div>
      </div>
    )
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'codes', label: 'Codes' },
    { id: 'vms', label: 'VMs' },
    { id: 'users', label: 'Users' },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="animate-fade-in mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-zinc-100">Admin</h1>
        {session?.user.name && (
          <span className="rounded-lg border border-indigo-800/50 bg-indigo-950/50 px-2.5 py-0.5 text-xs font-medium text-indigo-300">
            {session.user.name}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="animate-fade-in stagger-1 mb-6 flex gap-1 border-b border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-all duration-150 ${
              activeTab === tab.id
                ? 'border-b-2 border-indigo-500 text-indigo-300'
                : 'text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'codes' && <CodesTab />}
      {activeTab === 'vms' && <VMsTab />}
      {activeTab === 'users' && <UsersTab />}
    </div>
  )
}
