'use client'

import Link from 'next/link'
import { useSession, signIn, signOut } from 'next-auth/react'
import PointsBadge from './PointsBadge'
import Image from 'next/image'
import PButton from '@/components/baseui/pbutton'
import PixelSpinner from '@/components/baseui/spinner'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import Icon from './baseui/icon'
import { Gift, ChevronsLeftRightEllipsis } from 'lucide-react'
import VPNConfigModal from './VPNConfigModal'

const NEED_VPN = process.env.NEXT_PUBLIC_NEED_VPN === 'true'

export default function Header() {
  const { data: session, status } = useSession()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [vpnModalOpen, setVpnModalOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <>
    <header className="sticky top-0 z-30 border-b-2 border-zinc-700 bg-zinc-950/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        {/* Left: brand + nav */}
        <div className="flex items-center space-x-8">
          <Link
            href="/"
            className="text-2xl font-bold tracking-tight text-white transition-colors hover:text-blue-300"
          >
            Nelson{"'"}s Free VM
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link
              href="/"
              className="px-3 py-1.5 text-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 border border-transparent hover:border-zinc-700"
            >
              Dashboard
            </Link>
            {
              session && (
              <Link
                href="/vms"
                className="px-3 py-1.5 text-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 border border-transparent hover:border-zinc-700"
              >
                My VMs
              </Link>)
            }
          </nav>
        </div>

        {/* Right: points + user */}
        <div className="flex items-center gap-3">
          {status === 'authenticated' && session ? (
            <>
              <PointsBadge />
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(o => !o)}
                  className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-800 border border-transparent hover:border-zinc-700 transition-colors"
                >
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
                    <div className="flex h-8 w-8 items-center justify-center bg-blue-700 text-sm font-bold text-white ring-2 ring-zinc-600">
                      {(session.user.name ?? '?')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="hidden text-sm text-zinc-300 sm:inline">
                    {session.user.name}
                  </span>
                  <svg className="h-3 w-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={3} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-1 w-44 border-2 border-zinc-700 bg-zinc-900 shadow-lg z-30">
                    <button
                      onClick={() => {setDropdownOpen(false); router.push('/create')}}
                      className="w-full text-left px-4 py-2 text-blue-300 hover:bg-zinc-800 hover:text-white transition-colors items-center flex gap-2"
                    >
                      <Icon name='add' size={16} />
                      Create VM
                    </button>
                    <button
                      onClick={() => {setDropdownOpen(false); router.push('/create?bulk')}}
                      className="w-full text-left px-4 py-2 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors items-center flex gap-2"
                    >
                      <Icon name='addbulk' size={16} />
                      Bulk Create VM
                    </button>
                    <button
                      onClick={() => {setDropdownOpen(false); router.push('/redeem')}}
                      className="w-full text-left px-4 py-2 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors items-center flex gap-2"
                    >
                      <Gift size={16} />
                      Redeem Code
                    </button>
                    {NEED_VPN && (
                      <button
                        onClick={() => { setDropdownOpen(false); setVpnModalOpen(true) }}
                        className="w-full text-left px-4 py-2 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors items-center flex gap-2"
                      >
                        <ChevronsLeftRightEllipsis size={16} />
                        VPN Config
                      </button>
                    )}
                    <div className="border-t border-zinc-700" />
                    <button
                      onClick={() => { setDropdownOpen(false); signOut({ callbackUrl: '/' }) }}
                      className="w-full px-4 py-2 text-left text-red-400 hover:bg-zinc-800 hover:text-white transition-colors items-center flex gap-2"
                    >
                      <Icon name='logout' size={16} />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
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

    {NEED_VPN && (
      <VPNConfigModal
        open={vpnModalOpen}
        onClose={() => setVpnModalOpen(false)}
      />
    )}
  </>
  )
}
