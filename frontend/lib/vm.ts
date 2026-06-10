// Shared VM pricing/duration helpers used by the create wizard and renew flow.

export interface PricingData {
  price_cpu: number
  price_ram: number
  price_disk: number
  price_gpu: number
}

// Selectable durations. `hours` must stay in sync with backend DURATION_OPTIONS.
export const DURATION_OPTIONS: { label: string; hours: number }[] = [
  { label: '1h', hours: 1 },
  { label: '2h', hours: 2 },
  { label: '4h', hours: 4 },
  { label: '8h', hours: 8 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '36h', hours: 36 },
  { label: '48h', hours: 48 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
]

export function durationLabel(hours: number): string {
  return DURATION_OPTIONS.find((d) => d.hours === hours)?.label ?? `${hours}h`
}

export function computeCost(
  cpuCores: number,
  ramGb: number,
  diskGb: number,
  hasGpu: boolean,
  durationHours: number,
  pricing: PricingData,
): number {
  return Math.ceil(
    (cpuCores * pricing.price_cpu +
      ramGb * pricing.price_ram +
      diskGb * pricing.price_disk +
      (hasGpu ? pricing.price_gpu : 0)) *
      durationHours,
  )
}
