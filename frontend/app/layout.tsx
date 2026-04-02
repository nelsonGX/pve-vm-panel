import type { Metadata } from 'next'
import './globals.css'
import { auth } from '@/auth'
import SessionProviderWrapper from '@/components/SessionProviderWrapper'
import Header from '@/components/Header'

export const metadata: Metadata = {
  title: 'Nelson\'s Free VM',
  description: 'Get almost free VMs here!',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-950 text-zinc-100">
        <SessionProviderWrapper session={session}>
          <Header />
          <main className="flex flex-1 flex-col">{children}</main>
        </SessionProviderWrapper>
      </body>
    </html>
  )
}
