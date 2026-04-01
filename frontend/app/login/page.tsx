'use client'

import { signIn } from 'next-auth/react'
import { useEffect } from 'react'

export default function Login() {
  useEffect(() => {
    signIn('discord', { callbackUrl: '/' })
  }, [])

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-600 border-t-indigo-500" />
        <p className="text-gray-400">Redirecting to Discord...</p>
      </div>
    </div>
  )
}
