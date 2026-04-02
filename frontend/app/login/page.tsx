'use client'

import { signIn } from 'next-auth/react'
import { useEffect } from 'react'
import PixelSpinner from '@/components/baseui/spinner'

export default function Login() {
  useEffect(() => {
    signIn('discord', { callbackUrl: '/' })
  }, [])

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <div className="mb-3 flex justify-center">
          <PixelSpinner color="bg-indigo-400" size={10} />
        </div>
        <p className="text-zinc-400">Redirecting to Discord...</p>
      </div>
    </div>
  )
}
