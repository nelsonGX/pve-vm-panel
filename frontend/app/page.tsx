import Link from 'next/link'
import type { Session } from 'next-auth'
import { auth } from '@/auth'
import { apiFetch } from '@/lib/api'
import ResourceBar from '@/components/ResourceBar'
import ResourceTimeline from '@/components/ResourceTimeline'
import PDiv from '@/components/baseui/pdiv'

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

type AuthSession = Session | null

async function getResources(session: AuthSession): Promise<ResourcesData | null> {
  try {
    return await apiFetch('/resources', {}, session)
  } catch {
    return null
  }
}

async function getMe(session: AuthSession): Promise<MeData | null> {
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
        <h1 className="mb-1.5 text-3xl font-bold text-zinc-100">Nelson{"'"}s Free VM</h1>
        <p className="text-zinc-500">
          Get almost free VMs here!
        </p>
      </div>

      {session ? (
        <>
          <section className="animate-fade-in stagger-1 mb-8">
            <h2 className="mb-3 text-md font-semibold uppercase tracking-widest text-zinc-500">
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
            <h2 className="mb-3 text-md font-semibold uppercase tracking-widest text-zinc-500">
              Your Account
            </h2>
            <PDiv fullWidth padding="p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-8">
                <div>
                  <p className="text-3xl font-bold text-blue-300">
                    {me ? me.points.toLocaleString() : 'N/A'}
                  </p>
                  <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-zinc-300">Points</p>
                </div>
                <div className="h-10 w-px bg-zinc-700" />
                <div>
                  <p className="text-3xl font-bold text-emerald-400">
                    {me ? me.active_vm_count : 'N/A'}
                  </p>
                  <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-zinc-300">Active VMs</p>
                </div>
              </div>
              <p>
                Go to the <Link href="/vms" className="text-blue-400 hover:underline">My VMs</Link> page to see your active VMs, or click your avatar to create VMs, redeem codes and more.
              </p>
            </PDiv>
          </section>
        </>
      ) : (
        <section className="animate-fade-in stagger-3">
          <PDiv fullWidth padding="p-10">
            <div className="flex flex-col items-center gap-4">
              <p className="mb-5 text-zinc-400">
                Sign in with Discord to view cluster activity and start spinning up VMs.
              </p>
              <Link href="/login">
                <PDiv animated shadowColor="blue-700" borderColor="blue-400" padding="px-6 py-2.5">
                  <span className="text-md font-medium">Login with Discord</span>
                </PDiv>
              </Link>
            </div>
          </PDiv>
        </section>
      )}
    </div>
  )
}
