'use client'

import { useEffect, useEffectEvent, useState } from 'react'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import type { VM } from '@/components/VMCard'
import { DURATION_OPTIONS, computeCost, type PricingData } from '@/lib/vm'

interface RenewModalProps {
  open: boolean
  vm: VM | null
  pricing: PricingData | null
  balance: number
  loading?: boolean
  onConfirm: (durationHours: number) => void
  onClose: () => void
}

function SelectOptionButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <PButton
      variant={selected ? 'primary' : 'secondary'}
      onClick={onClick}
      className={selected ? '' : 'opacity-90'}
      customInnerClass="pt-2 pb-2.5"
    >
      {children}
    </PButton>
  )
}

export default function RenewModal({
  open,
  vm,
  pricing,
  balance,
  loading = false,
  onConfirm,
  onClose,
}: RenewModalProps) {
  const [durationHours, setDurationHours] = useState(1)
  const onCloseEvent = useEffectEvent(onClose)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && !loading) onCloseEvent()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, loading])

  if (!open || !vm) return null

  const cost =
    pricing !== null
      ? computeCost(vm.cpu_cores, vm.ram_gb, vm.disk_gb, vm.has_gpu, durationHours, pricing)
      : null
  const remaining = cost !== null ? balance - cost : null
  const canAfford = remaining !== null && remaining >= 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/80"
        onClick={() => !loading && onClose()}
      />
      <div className="animate-scale-in relative w-full max-w-md">
        <PDiv fullWidth padding="p-6">
          <h2 className="mb-1 text-lg font-semibold text-zinc-100">Renew {vm.name}</h2>
          <p className="mb-4 text-sm text-zinc-400">
            Extend this VM&apos;s expiry. Time is added on top of any remaining time.
          </p>

          <p className="mb-2 text-sm font-medium text-zinc-300">Extend by</p>
          <div className="mb-5 flex flex-wrap gap-2">
            {DURATION_OPTIONS.map((d) => (
              <SelectOptionButton
                key={d.hours}
                selected={durationHours === d.hours}
                onClick={() => setDurationHours(d.hours)}
              >
                {d.label}
              </SelectOptionButton>
            ))}
          </div>

          <dl className="mb-5 flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-300">Cost</dt>
              <dd className="font-semibold text-zinc-100">
                {cost !== null ? `${cost.toLocaleString()} pts` : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Your balance</dt>
              <dd className="font-semibold text-zinc-400">{balance.toLocaleString()} pts</dd>
            </div>
            <div className="my-1 border-t border-zinc-700" />
            <div className="flex justify-between">
              <dt className="text-zinc-300">After renewal</dt>
              <dd
                className={`font-bold ${
                  remaining === null
                    ? 'text-zinc-500'
                    : remaining < 0
                    ? 'text-red-400'
                    : 'text-emerald-400'
                }`}
              >
                {remaining !== null ? `${remaining.toLocaleString()} pts` : '—'}
              </dd>
            </div>
          </dl>

          {!canAfford && cost !== null && (
            <p className="mb-4 text-sm text-red-400">Insufficient points to renew this VM.</p>
          )}

          <div className="flex justify-end gap-3">
            <PButton variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </PButton>
            <PButton
              variant="primary"
              onClick={() => onConfirm(durationHours)}
              loading={loading}
              disabled={!canAfford}
            >
              Renew
            </PButton>
          </div>
        </PDiv>
      </div>
    </div>
  )
}
