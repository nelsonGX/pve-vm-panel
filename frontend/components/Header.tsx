'use client'

import Link from 'next/link'
import { useSession, signIn, signOut } from 'next-auth/react'
import PointsBadge from './PointsBadge'
import Image from 'next/image'
import PButton from '@/components/baseui/pbutton'
import PixelSpinner from '@/components/baseui/spinner'

export default function Header() {
  const { data: session, status } = useSession()

  return (
    <header className="sticky top-0 z-50 border-b-2 border-zinc-700 bg-zinc-950/95 backdrop-blur-md">
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
              className="px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 border border-transparent hover:border-zinc-700"
            >
              Home
            </Link>
            <Link
              href="/vms"
              className="px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 border border-transparent hover:border-zinc-700"
            >
              My VMs
            </Link>
            <Link
              href="/create"
              className="px-3 py-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 border border-transparent hover:border-zinc-700"
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
                    className="ring-2 ring-zinc-600"
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center bg-indigo-700 text-sm font-bold text-white ring-2 ring-zinc-600">
                    {(session.user.name ?? '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="hidden text-sm text-zinc-300 sm:inline">
                  {session.user.name}
                </span>
              </div>
              <PButton
                variant="gray"
                customInnerClass="py-1"
                onClick={() => signOut({ callbackUrl: '/' })}
              >
                Sign out
              </PButton>
            </>
          ) : status === 'loading' ? (
            <PixelSpinner color="bg-zinc-500" size={6} />
          ) : (
            <PButton
              variant="primary"
              customInnerClass="py-1"
              onClick={() => signIn('discord', { callbackUrl: '/' })}
            >
              Login with Discord
            </PButton>
          )}
        </div>
      </div>
    </header>
  )
}
