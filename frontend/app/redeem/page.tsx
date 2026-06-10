import type { Metadata } from 'next'
import RedeemPageClient from './RedeemPageClient'

export const metadata: Metadata = {
  title: 'Redeem Code | Nelson\'s Free VM',
  description: 'Redeem a gift code to add points to your VM account.',
}

export default function RedeemPage() {
  return <RedeemPageClient />
}
