import type { Metadata } from 'next'
import PayReturnClient from './PayReturnClient'

export const metadata: Metadata = {
  title: 'Payment | Nelson\'s Free VM',
  description: 'Confirming your credit top-up.',
}

export default function PayReturnPage() {
  return <PayReturnClient />
}
