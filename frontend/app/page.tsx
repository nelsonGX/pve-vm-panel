import Link from 'next/link'
import { auth } from '@/auth'
import { apiFetch } from '@/lib/api'
import ResourceBar from '@/components/ResourceBar'
import ResourceTimeline from '@/components/ResourceTimeline'
import PDiv from '@/components/baseui/pdiv'
import PButton from '@/components/baseui/pbutton'

interface ResourcesData {
  cpu: { available: number; total: number }
  ram_gb: { available: number; total: number }
  disk_gb: { available: number; total: number }
  gpus: { id: string; available: boolean }[]
}

interface MeData {
  points: number
  active_vm_count: number
}

async function getResources(session: Awaited<ReturnType<typeof auth>>): Promise<ResourcesData | null> {
  try {
    return await apiFetch('/resources', {}, session)
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
  const [resources, me] = session
    ? await Promise.all([getResources(session), getMe(session)])
    : [null, null]

  const gpuUsed = resources ? resources.gpus.filter((g) => !g.available).length : 0
  const gpuTotal = resources ? resources.gpus.length : 0

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="animate-fade-in mb-8">
        <h1 className="mb-1.5 text-3xl font-bold text-zinc-100">PVE Panel</h1>
        <p className="text-zinc-500">
          Spin up ephemeral Proxmox VMs using your point balance.
        </p>
      </div>

      {session ? (
        <>
          <section className="animate-fade-in stagger-1 mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Cluster Resources
            </h2>
            <PDiv fullWidth padding="p-6">
              {resources ? (
                <div className="flex flex-col gap-5">
                  <ResourceBar
                    label="CPU"
                    used={resources.cpu.total - resources.cpu.available}
                    total={resources.cpu.total}
                    unit="cores"
                  />
                  <ResourceBar
                    label="RAM"
                    used={resources.ram_gb.total - resources.ram_gb.available}
                    total={resources.ram_gb.total}
                    unit="GB"
                  />
                  <ResourceBar
                    label="Disk"
                    used={resources.disk_gb.total - resources.disk_gb.available}
                    total={resources.disk_gb.total}
                    unit="GB"
                  />
                  {gpuTotal > 0 && (
                    <ResourceBar
                      label="GPU Slots"
                      used={gpuUsed}
                      total={gpuTotal}
                      unit="slots"
                    />
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Could not load resource stats.</p>
              )}
            </PDiv>
          </section>

          <section className="animate-fade-in stagger-2 mb-8">
            <ResourceTimeline />
          </section>

          <section className="animate-fade-in stagger-3">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Your Account
            </h2>
            <PDiv fullWidth padding="p-6">
              <div className="mb-5 flex flex-wrap items-center gap-8">
                <div>
                  <p className="text-3xl font-bold text-indigo-300">
                    {me ? me.points.toLocaleString() : '—'}
                  </p>
                  <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-zinc-500">Points</p>
                </div>
                <div className="h-10 w-px bg-zinc-700" />
                <div>
                  <p className="text-3xl font-bold text-emerald-400">
                    {me ? me.active_vm_count : '—'}
                  </p>
                  <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-zinc-500">Active VMs</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/create">
                  <PDiv animated shadowColor="indigo-700" borderColor="indigo-400" padding="px-4 py-2">
                    <span className="text-sm font-medium text-indigo-200">Create VM</span>
                  </PDiv>
                </Link>
                <Link href="/vms">
                  <PDiv animated padding="px-4 py-2">
                    <span className="text-sm font-medium text-zinc-200">My VMs</span>
                  </PDiv>
                </Link>
                <Link href="/redeem">
                  <PDiv animated padding="px-4 py-2">
                    <span className="text-sm font-medium text-zinc-200">Redeem Code</span>
                  </PDiv>
                </Link>
              </div>
            </PDiv>
          </section>
        </>
      ) : (
        <section className="animate-fade-in stagger-3">
          <PDiv fullWidth padding="p-10">
            <div className="text-center">
              <p className="mb-5 text-zinc-400">
                Sign in with Discord to view cluster activity and start spinning up VMs.
              </p>
              <Link href="/login">
                <PDiv animated shadowColor="indigo-700" borderColor="indigo-400" padding="px-6 py-2.5">
                  <span className="text-sm font-medium text-indigo-200">Login with Discord</span>
                </PDiv>
              </Link>
            </div>
          </PDiv>
        </section>
      )}
    </div>
  )
}
