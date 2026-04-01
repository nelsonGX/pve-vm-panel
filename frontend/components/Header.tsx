'use client'

import Link from 'next/link'
import { useSession, signIn, signOut } from 'next-auth/react'
import PointsBadge from './PointsBadge'
import Image from 'next/image'

export default function Header() {
  const { data: session, status } = useSession()

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Left: brand + nav */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-indigo-400 transition-colors hover:text-indigo-300"
          >
            PVE Panel
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link
              href="/"
              className="rounded-md px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              Home
            </Link>
            <Link
              href="/vms"
              className="rounded-md px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              My VMs
            </Link>
            <Link
              href="/create"
              className="rounded-md px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
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
                    className="rounded-full ring-2 ring-zinc-700"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-700 text-sm font-bold text-white ring-2 ring-zinc-700">
                    {(session.user.name ?? '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="hidden text-sm text-zinc-300 sm:inline">
                  {session.user.name}
                </span>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-all duration-150 hover:border-zinc-600 hover:bg-zinc-700 hover:text-zinc-100 active:scale-95"
              >
                Sign out
              </button>
            </>
          ) : status === 'loading' ? (
            <div className="h-8 w-24 animate-pulse rounded-lg bg-zinc-800" />
          ) : (
            <button
              onClick={() => signIn('discord', { callbackUrl: '/' })}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm shadow-indigo-900/50 transition-all duration-150 hover:bg-indigo-500 active:scale-95"
            >
              Login with Discord
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
