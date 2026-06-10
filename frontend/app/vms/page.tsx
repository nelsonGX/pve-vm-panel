import type { Metadata } from 'next'
import VMsPageClient from './VMsPageClient'

export const metadata: Metadata = {
  title: 'My VMs | Nelson\'s Free VM',
  description: 'View and manage your active, stopped, and past virtual machines.',
}

export default function VMsPage() {
  return <VMsPageClient />
}
