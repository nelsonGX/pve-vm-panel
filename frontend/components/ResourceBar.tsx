interface ResourceBarProps {
  label: string
  used: number
  total: number
  unit: string
}

export default function ResourceBar({ label, used, total, unit }: ResourceBarProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0

  let fillClass = 'bg-green-500'
  if (pct >= 100) {
    fillClass = 'bg-red-500'
  } else if (pct >= 80) {
    fillClass = 'bg-yellow-500'
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-300">{label}</span>
        <span className="text-gray-400">
          {used} / {total} {unit}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-sm bg-gray-700">
        <div
          className={`h-full transition-all duration-300 ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
