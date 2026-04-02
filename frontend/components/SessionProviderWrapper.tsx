'use client'

import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'
import { ToastProvider } from '@/components/baseui/toast-manager'
import { ToastSetup } from '@/components/baseui/toast-setup'

export default function SessionProviderWrapper({
  children,
  session,
}: {
  children: React.ReactNode
  session: Session | null
}) {
  return (
    <SessionProvider session={session}>
      <ToastProvider>
        <ToastSetup />
        {children}
      </ToastProvider>
    </SessionProvider>
  )
}
