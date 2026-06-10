import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import AdminPageClient from './AdminPageClient'

export const metadata: Metadata = {
  title: 'Admin | Nelson\'s Free VM',
  description: 'Administrative tools for VM, user, and redemption code management.',
}

export default async function AdminPage() {
  const session = await auth()
  if (!session) redirect('/login')

  return <AdminPageClient />
}
