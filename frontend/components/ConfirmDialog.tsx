'use client'

import { useEffect, useRef } from 'react'

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-semibold text-gray-100">{title}</h2>
        <p className="mb-6 text-sm text-gray-400">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded px-4 py-2 text-sm font-medium transition-colors ${
              danger
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
