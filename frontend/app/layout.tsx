import type { Metadata } from 'next'
import './globals.css'
import { auth } from '@/auth'
import SessionProviderWrapper from '@/components/SessionProviderWrapper'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: 'PVE Panel',
  description: 'Spin up ephemeral Proxmox VMs with your point balance',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-gray-950 text-gray-100">
        <SessionProviderWrapper session={session}>
          <Header />
          <main className="flex flex-1 flex-col">{children}</main>
        </SessionProviderWrapper>
      </body>
    </html>
  )
}
