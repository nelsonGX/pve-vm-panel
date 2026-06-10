import type { Metadata } from 'next'
import LoginPageClient from './LoginPageClient'

export const metadata: Metadata = {
  title: 'Login | Nelson\'s Free VM',
  description: 'Sign in with Discord to access your VM dashboard.',
}

export default function LoginPage() {
  return <LoginPageClient />
}
