import Link from 'next/link'
import { auth } from '@/auth'
import { apiFetch } from '@/lib/api'
import ResourceBar from '@/components/ResourceBar'

interface ResourcesData {
  cpu_total: number
  cpu_used: number
  ram_total_gb: number
  ram_used_gb: number
  disk_total_gb: number
  disk_used_gb: number
  gpu_total: number
  gpu_used: number
}

interface MeData {
  points: number
  active_vm_count: number
}

async function getResources(): Promise<ResourcesData | null> {
  try {
    return await apiFetch('/resources')
  } catch {
    return null
  }
}

async function getMe(session: Awaited<ReturnType<typeof auth>>): Promise<MeData | null> {
  if (!session) return null
  try {
    return await apiFetch('/me', {}, session)
  } catch {
    return null
  }
}

export default async function HomePage() {
  const session = await auth()
  const [resources, me] = await Promise.all([getResources(), getMe(session)])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="mb-2 text-3xl font-bold text-gray-100">PVE Panel</h1>
      <p className="mb-8 text-gray-400">
        Spin up ephemeral Proxmox VMs using your point balance.
      </p>

      {/* Resource stats */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Cluster Resources
        </h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
          {resources ? (
            <div className="flex flex-col gap-4">
              <ResourceBar
                label="CPU"
                used={resources.cpu_used}
                total={resources.cpu_total}
                unit="cores"
              />
              <ResourceBar
                label="RAM"
                used={resources.ram_used_gb}
                total={resources.ram_total_gb}
                unit="GB"
              />
              <ResourceBar
                label="Disk"
                used={resources.disk_used_gb}
                total={resources.disk_total_gb}
                unit="GB"
              />
              {resources.gpu_total > 0 && (
                <ResourceBar
                  label="GPU Slots"
                  used={resources.gpu_used}
                  total={resources.gpu_total}
                  unit="slots"
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Could not load resource stats.
            </p>
          )}
        </div>
      </section>

      {/* Auth section */}
      {session ? (
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Your Account
          </h2>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <div className="mb-4 flex flex-wrap items-center gap-6">
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-300">
                  {me ? me.points.toLocaleString() : '—'}
                </p>
                <p className="text-xs text-gray-500">Points</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-400">
                  {me ? me.active_vm_count : '—'}
                </p>
                <p className="text-xs text-gray-500">Active VMs</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/create"
                className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              >
                Create VM
              </Link>
              <Link
                href="/vms"
                className="rounded bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
              >
                My VMs
              </Link>
              <Link
                href="/redeem"
                className="rounded bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
              >
                Redeem Code
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
          <p className="mb-4 text-gray-300">
            Sign in with Discord to start spinning up VMs.
          </p>
          <Link
            href="/login"
            className="inline-block rounded bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Login with Discord
          </Link>
        </section>
      )}
    </div>
  )
}
