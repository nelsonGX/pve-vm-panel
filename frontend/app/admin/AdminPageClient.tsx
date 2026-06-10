'use client'

import { useEffect, useState, useCallback, useReducer } from 'react'
import { useSession } from 'next-auth/react'
import { clientApiFetch } from '@/lib/api'
import ConfirmDialog from '@/components/ConfirmDialog'
import PButton from '@/components/baseui/pbutton'
import PInput from '@/components/baseui/pinput'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'

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

const ADMIN_VM_STATUS_STYLES: Record<string, string> = {
  running: 'border-emerald-700 bg-emerald-950 text-emerald-400',
  provisioning: 'border-amber-700 bg-amber-950 text-amber-400',
  error: 'border-red-700 bg-red-950 text-red-400',
  expired: 'border-zinc-700 bg-zinc-800 text-zinc-500',
}

const ADMIN_TABS: { id: Tab; label: string }[] = [
  { id: 'codes', label: 'Codes' },
  { id: 'vms', label: 'VMs' },
  { id: 'users', label: 'Users' },
]

interface CodesState {
  codes: Code[]
  loading: boolean
  error: string | null
  deleteTarget: string | null
  newPoints: number
  newMaxUses: number
  creating: boolean
  createError: string | null
}

type CodesAction =
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; codes: Code[] }
  | { type: 'loadFailed'; error: string }
  | { type: 'deleteTargetChanged'; value: string | null }
  | { type: 'newPointsChanged'; value: number }
  | { type: 'newMaxUsesChanged'; value: number }
  | { type: 'createStarted' }
  | { type: 'createFailed'; error: string }
  | { type: 'createFinished' }
  | { type: 'codeRemoved'; id: string }

const codesInitialState: CodesState = {
  codes: [],
  loading: true,
  error: null,
  deleteTarget: null,
  newPoints: 100,
  newMaxUses: 1,
  creating: false,
  createError: null,
}

function codesReducer(state: CodesState, action: CodesAction): CodesState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, loading: true, error: null }
    case 'loadSucceeded':
      return { ...state, loading: false, codes: action.codes }
    case 'loadFailed':
      return { ...state, loading: false, error: action.error }
    case 'deleteTargetChanged':
      return { ...state, deleteTarget: action.value }
    case 'newPointsChanged':
      return { ...state, newPoints: action.value }
    case 'newMaxUsesChanged':
      return { ...state, newMaxUses: action.value }
    case 'createStarted':
      return { ...state, creating: true, createError: null }
    case 'createFailed':
      return { ...state, creating: false, createError: action.error }
    case 'createFinished':
      return { ...state, creating: false }
    case 'codeRemoved':
      return {
        ...state,
        codes: state.codes.filter((c) => c.id !== action.id),
        deleteTarget: null,
      }
  }
}

interface UsersState {
  users: AdminUser[]
  loading: boolean
  error: string | null
  adjustTarget: string | null
  adjustDelta: number
  adjustReason: string
  adjusting: boolean
  adjustError: string | null
}

type UsersAction =
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; users: AdminUser[] }
  | { type: 'loadFailed'; error: string }
  | { type: 'adjustOpened'; userId: string }
  | { type: 'adjustClosed' }
  | { type: 'adjustDeltaChanged'; value: number }
  | { type: 'adjustReasonChanged'; value: string }
  | { type: 'adjustStarted' }
  | { type: 'adjustFailed'; error: string }
  | { type: 'adjustSucceeded' }
  | { type: 'adjustErrorCleared' }

const usersInitialState: UsersState = {
  users: [],
  loading: true,
  error: null,
  adjustTarget: null,
  adjustDelta: 0,
  adjustReason: '',
  adjusting: false,
  adjustError: null,
}

function usersReducer(state: UsersState, action: UsersAction): UsersState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, loading: true, error: null }
    case 'loadSucceeded':
      return { ...state, loading: false, users: action.users }
    case 'loadFailed':
      return { ...state, loading: false, error: action.error }
    case 'adjustOpened':
      return {
        ...state,
        adjustTarget: action.userId,
        adjustDelta: 0,
        adjustReason: '',
        adjustError: null,
      }
    case 'adjustClosed':
      return { ...state, adjustTarget: null, adjustError: null }
    case 'adjustDeltaChanged':
      return { ...state, adjustDelta: action.value }
    case 'adjustReasonChanged':
      return { ...state, adjustReason: action.value }
    case 'adjustStarted':
      return { ...state, adjusting: true, adjustError: null }
    case 'adjustFailed':
      return { ...state, adjusting: false, adjustError: action.error }
    case 'adjustSucceeded':
      return {
        ...state,
        adjustTarget: null,
        adjustDelta: 0,
        adjustReason: '',
        adjusting: false,
        adjustError: null,
      }
    case 'adjustErrorCleared':
      return { ...state, adjustError: null }
  }
}

function CodesTab() {
  const [state, dispatch] = useReducer(codesReducer, codesInitialState)
  const {
    codes,
    loading,
    error,
    deleteTarget,
    newPoints,
    newMaxUses,
    creating,
    createError,
  } = state

  const loadCodes = useCallback(async () => {
    dispatch({ type: 'loadStarted' })
    try {
      const data = await clientApiFetch('/admin/codes')
      dispatch({ type: 'loadSucceeded', codes: (data as { items: Code[] }).items })
    } catch (err) {
      dispatch({
        type: 'loadFailed',
        error: err instanceof Error ? err.message : 'Failed to load codes',
      })
    }
  }, [])

  useEffect(() => { loadCodes() }, [loadCodes])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    dispatch({ type: 'createStarted' })
    try {
      await clientApiFetch('/admin/codes', {
        method: 'POST',
        body: JSON.stringify({ points_value: newPoints, max_uses: newMaxUses }),
      })
      await loadCodes()
    } catch (err) {
      dispatch({
        type: 'createFailed',
        error: err instanceof Error ? err.message : 'Failed to create code',
      })
    } finally {
      dispatch({ type: 'createFinished' })
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await clientApiFetch(`/admin/codes/${deleteTarget}`, { method: 'DELETE' })
      dispatch({ type: 'codeRemoved', id: deleteTarget })
    } catch {
      await loadCodes()
    } finally {
      dispatch({ type: 'deleteTargetChanged', value: null })
    }
  }

  if (loading) return <div className="py-8 flex justify-center"><PixelSpinner color="bg-zinc-500" size={8} /></div>
  if (error) return <div className="py-8 text-center text-red-400">{error}</div>

  return (
    <div className="animate-fade-in">
      <form onSubmit={handleCreate} className="mb-5">
        <PDiv fullWidth padding="p-5">
          <h3 className="mb-4 text-sm font-semibold text-zinc-200">Create Code</h3>
          <div className="flex flex-wrap gap-3">
            <div>
              <label htmlFor="admin-code-points" className="mb-1.5 block text-xs font-medium text-zinc-500">Points</label>
              <PInput id="admin-code-points" type="number" value={String(newPoints)} onChange={(e) => dispatch({ type: 'newPointsChanged', value: parseInt(e.target.value) || 1 })} minWidth="7rem" />
            </div>
            <div>
              <label htmlFor="admin-code-max-uses" className="mb-1.5 block text-xs font-medium text-zinc-500">Max Uses</label>
              <PInput id="admin-code-max-uses" type="number" value={String(newMaxUses)} onChange={(e) => dispatch({ type: 'newMaxUsesChanged', value: parseInt(e.target.value) || 1 })} minWidth="6rem" />
            </div>
            <div className="flex items-end">
              <PButton type="submit" variant="primary" disabled={creating} loading={creating}>
                {creating ? 'Creating...' : 'Create'}
              </PButton>
            </div>
          </div>
          {createError && <p className="mt-2 text-xs text-red-400">{createError}</p>}
        </PDiv>
      </form>

      {codes.length === 0 ? (
        <p className="text-sm text-zinc-500">No codes yet.</p>
      ) : (
        <PDiv fullWidth padding="p-0" innerClassName="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-800">
              <tr>
                {['Code', 'Points', 'Uses', 'Expires', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id} className="border-t border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/40">
                  <td className="px-4 py-2.5 font-mono text-zinc-200">{c.code}</td>
                  <td className="px-4 py-2.5 text-zinc-300">{c.points_value.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{c.current_uses} / {c.max_uses}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2.5">
                    <PButton variant="danger" customInnerClass="py-0.5" onClick={() => dispatch({ type: 'deleteTargetChanged', value: c.id })}>Delete</PButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PDiv>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Code"
        message="Delete this redemption code? Existing users who have redeemed it keep their points."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => dispatch({ type: 'deleteTargetChanged', value: null })}
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

  if (loading) return <div className="py-8 flex justify-center"><PixelSpinner color="bg-zinc-500" size={8} /></div>
  if (error) return <div className="py-8 text-center text-red-400">{error}</div>
  if (vms.length === 0) return <p className="text-sm text-zinc-500">No active VMs.</p>

  return (
    <div className="animate-fade-in">
      <PDiv fullWidth padding="p-0" innerClassName="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800">
            <tr>
              {['VM', 'Owner', 'Specs', 'IP', 'Status', 'Expires', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vms.map((vm) => (
              <tr key={vm.vm_id} className="border-t border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/40">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-zinc-200">{vm.username ?? vm.vm_id}</p>
                  <p className="text-xs text-zinc-500">{vm.os}</p>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">{vm.user_id}</td>
                <td className="px-4 py-2.5 text-zinc-400">{vm.cpu_cores}C / {vm.ram_gb}GB / {vm.disk_gb}GB</td>
                <td className="px-4 py-2.5 font-mono text-zinc-300">{vm.ip_address ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={`border px-2 py-0.5 text-xs font-medium ${ADMIN_VM_STATUS_STYLES[vm.status] ?? 'border-zinc-700 bg-zinc-800 text-zinc-500'}`}>
                    {vm.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">{new Date(vm.expires_at).toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  <PButton variant="danger" customInnerClass="py-0.5" onClick={() => setDeleteTarget(vm.vm_id)}>Force Delete</PButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PDiv>

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
  const [state, dispatch] = useReducer(usersReducer, usersInitialState)
  const {
    users,
    loading,
    error,
    adjustTarget,
    adjustDelta,
    adjustReason,
    adjusting,
    adjustError,
  } = state

  const loadUsers = useCallback(async () => {
    dispatch({ type: 'loadStarted' })
    try {
      const data = await clientApiFetch('/admin/users')
      dispatch({ type: 'loadSucceeded', users: (data as { items: AdminUser[] }).items })
    } catch (err) {
      dispatch({
        type: 'loadFailed',
        error: err instanceof Error ? err.message : 'Failed to load users',
      })
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault()
    if (!adjustTarget || adjustDelta === 0) return
    dispatch({ type: 'adjustStarted' })
    try {
      await clientApiFetch(`/admin/users/${adjustTarget}/adjust-points`, {
        method: 'POST',
        body: JSON.stringify({ delta: adjustDelta, reason: adjustReason }),
      })
      dispatch({ type: 'adjustSucceeded' })
      await loadUsers()
    } catch (err) {
      dispatch({
        type: 'adjustFailed',
        error: err instanceof Error ? err.message : 'Failed to adjust points',
      })
    }
  }

  if (loading) return <div className="py-8 flex justify-center"><PixelSpinner color="bg-zinc-500" size={8} /></div>
  if (error) return <div className="py-8 text-center text-red-400">{error}</div>

  return (
    <div className="animate-fade-in">
      <PDiv fullWidth padding="p-0" innerClassName="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-800">
            <tr>
              {['User', 'Discord ID', 'Points', 'Joined', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.discord_id} className="border-t border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/40">
                <td className="px-4 py-2.5 font-medium text-zinc-200">{u.discord_username}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-600">{u.discord_id}</td>
                <td className="px-4 py-2.5 font-medium text-blue-300">{u.points.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-zinc-500">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2.5">
                  {adjustTarget === u.discord_id ? (
                    <form onSubmit={handleAdjust} className="flex flex-col gap-1.5 min-w-55">
                      <div className="flex gap-1.5">
                        <PInput type="number" value={String(adjustDelta)} onChange={(e) => dispatch({ type: 'adjustDeltaChanged', value: parseInt(e.target.value) || 0 })} placeholder="±points" minWidth="6rem" />
                        <PInput type="text" value={adjustReason} onChange={(e) => dispatch({ type: 'adjustReasonChanged', value: e.target.value })} placeholder="Reason" minWidth="8rem" />
                      </div>
                      {adjustError && <p className="text-xs text-red-400">{adjustError}</p>}
                      <div className="flex gap-1.5">
                        <PButton type="submit" variant="primary" disabled={adjusting || adjustDelta === 0} loading={adjusting} customInnerClass="py-0.5">
                          {adjusting ? '...' : 'Apply'}
                        </PButton>
                        <PButton type="button" variant="secondary" customInnerClass="py-0.5" onClick={() => dispatch({ type: 'adjustClosed' })}>
                          Cancel
                        </PButton>
                      </div>
                    </form>
                  ) : (
                    <PButton variant="gray" customInnerClass="py-0.5" onClick={() => dispatch({ type: 'adjustOpened', userId: u.discord_id })}>
                      Adjust Points
                    </PButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PDiv>
    </div>
  )
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState<Tab>('codes')
  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    if (status === 'authenticated') {
      clientApiFetch('/admin/check').catch(() => setForbidden(true))
    }
  }, [status])

  if (status === 'loading') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <PixelSpinner color="bg-blue-400" size={10} />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <PDiv shadowColor="red-800" borderColor="red-400" padding="p-8">
          <div className="text-center">
            <p className="text-xl font-bold text-red-400">403 Forbidden</p>
            <p className="mt-2 text-sm text-zinc-400">You do not have admin access.</p>
          </div>
        </PDiv>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="animate-fade-in mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-zinc-100">Admin</h1>
        {session?.user.name && (
          <span className="border border-blue-700 bg-blue-950 px-2.5 py-0.5 text-xs font-medium text-blue-300">
            {session.user.name}
          </span>
        )}
      </div>

      <div className="animate-fade-in stagger-1 mb-6 flex gap-2 border-b-2 border-zinc-700 pb-2">
        {ADMIN_TABS.map((tab) => (
          <PButton
            key={tab.id}
            variant={activeTab === tab.id ? 'primary' : 'secondary'}
            customInnerClass="py-1.5"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </PButton>
        ))}
      </div>

      {activeTab === 'codes' && <CodesTab />}
      {activeTab === 'vms' && <VMsTab />}
      {activeTab === 'users' && <UsersTab />}
    </div>
  )
}
