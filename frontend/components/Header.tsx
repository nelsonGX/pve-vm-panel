'use client'

import Link from 'next/link'
import { useSession, signIn, signOut } from 'next-auth/react'
import PointsBadge from './PointsBadge'
import Image from 'next/image'

export default function Header() {
  const { data: session, status } = useSession()

  return (
    <header className="sticky top-0 z-50 border-b border-gray-800 bg-gray-900">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Left: brand + nav */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-indigo-400 hover:text-indigo-300"
          >
            PVE Panel
          </Link>
          <nav className="hidden items-center gap-4 text-sm md:flex">
            <Link
              href="/"
              className="text-gray-300 transition-colors hover:text-gray-100"
            >
              Home
            </Link>
            <Link
              href="/vms"
              className="text-gray-300 transition-colors hover:text-gray-100"
            >
              My VMs
            </Link>
            <Link
              href="/create"
              className="text-gray-300 transition-colors hover:text-gray-100"
            >
              Create
            </Link>
          </nav>
        </div>

        {/* Right: points + user */}
        <div className="flex items-center gap-3">
          {status === 'authenticated' && session ? (
            <>
              <PointsBadge />
              <div className="flex items-center gap-2">
                {session.user.image ? (
                  <Image
                    src={session.user.image}
                    alt={session.user.name ?? 'avatar'}
                    width={32}
                    height={32}
                    className="rounded"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-700 text-sm font-bold text-white">
                    {(session.user.name ?? '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="hidden text-sm text-gray-300 sm:inline">
                  {session.user.name}
                </span>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:bg-gray-600"
              >
                Sign out
              </button>
            </>
          ) : status === 'loading' ? (
            <div className="h-8 w-24 animate-pulse rounded bg-gray-700" />
          ) : (
            <button
              onClick={() => signIn('discord', { callbackUrl: '/' })}
              className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Login with Discord
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
