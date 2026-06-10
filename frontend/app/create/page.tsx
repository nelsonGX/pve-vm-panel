import type { Metadata } from 'next'
import CreatePageClient from './CreatePageClient'

export const metadata: Metadata = {
  title: 'Create VM | Nelson\'s Free VM',
  description: 'Configure and launch a VM from available cluster resources.',
}

export default function CreatePage() {
  return <CreatePageClient />
}
