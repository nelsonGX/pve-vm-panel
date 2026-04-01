interface ResourceBarProps {
  label: string
  used: number
  total: number
  unit: string
}

export default function ResourceBar({ label, used, total, unit }: ResourceBarProps) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0

  let fillClass = 'bg-emerald-500'
  let textClass = 'text-emerald-400'
  if (pct >= 100) {
    fillClass = 'bg-red-500'
    textClass = 'text-red-400'
  } else if (pct >= 80) {
    fillClass = 'bg-amber-500'
    textClass = 'text-amber-400'
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-200">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">
            {used} / {total} {unit}
          </span>
          <span className={`text-xs font-semibold tabular-nums ${textClass}`}>
            {pct.toFixed(0)}%
          </span>
        </div>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
