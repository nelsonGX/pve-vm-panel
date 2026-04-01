'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { clientApiFetch } from '@/lib/api'

export default function PointsBadge() {
  const { data: session, status } = useSession()
  const [points, setPoints] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (status !== 'authenticated') return

    setLoading(true)
    clientApiFetch('/me')
      .then((data: { points: number }) => setPoints(data.points))
      .catch(() => setPoints(null))
      .finally(() => setLoading(false))
  }, [status, session])

  if (status !== 'authenticated') return null

  if (loading || points === null) {
    return (
      <div className="h-7 w-24 animate-pulse rounded-lg bg-zinc-800" />
    )
  }

  return (
    <span className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1 text-sm font-medium text-indigo-300">
      <svg className="h-3.5 w-3.5 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2L9.19 8.63L2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z" />
      </svg>
      {points.toLocaleString()} pts
    </span>
  )
}
