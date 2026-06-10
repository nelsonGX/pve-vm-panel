'use client'

import { useEffect, useEffectEvent } from 'react'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLoading?: boolean
  confirmLabel?: string
  danger?: boolean
}

export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLoading = false,
  confirmLabel = 'Confirm',
  danger = false,
}: ConfirmDialogProps) {
  const onCancelEvent = useEffectEvent(onCancel)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onCancelEvent()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/80"
        onClick={onCancel}
      />
      <div
        className="animate-scale-in relative w-full max-w-md"
      >
        <PDiv fullWidth padding="p-6">
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">{title}</h2>
          <p className="mb-6 text-sm text-zinc-400">{message}</p>
          <div className="flex justify-end gap-3">
            <PButton variant="secondary" onClick={onCancel}>
              Cancel
            </PButton>
            <PButton variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={confirmLoading}>
              {confirmLabel}
            </PButton>
          </div>
        </PDiv>
      </div>
    </div>
  )
}
