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
      <div className="h-6 w-20 animate-pulse rounded bg-gray-700" />
    )
  }

  return (
    <span className="flex items-center gap-1 rounded bg-gray-800 px-2.5 py-1 text-sm font-medium text-indigo-300 ring-1 ring-gray-700">
      <span aria-hidden>&#11042;</span>
      {points.toLocaleString()} pts
    </span>
  )
}
