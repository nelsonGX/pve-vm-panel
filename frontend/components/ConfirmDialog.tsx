'use client'

import { useEffect, useRef } from 'react'
import PButton from '@/components/baseui/pbutton'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  danger?: boolean
}

export default function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  danger = false,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onCancel}
    >
      <div
        className="animate-scale-in w-full max-w-md border-b-4 border-r-4 border-zinc-600 bg-zinc-600 pixel-panel-outer"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-4 border-zinc-400 bg-zinc-900 pixel-panel-inner p-6">
          <h2 className="mb-2 text-lg font-semibold text-zinc-100">{title}</h2>
          <p className="mb-6 text-sm text-zinc-400">{message}</p>
          <div className="flex justify-end gap-3">
            <PButton
              variant="secondary"
              onClick={onCancel}
            >
              Cancel
            </PButton>
            <PButton
              variant={danger ? 'danger' : 'primary'}
              onClick={onConfirm}
            >
              {confirmLabel}
            </PButton>
          </div>
        </div>
      </div>
    </div>
  )
}
