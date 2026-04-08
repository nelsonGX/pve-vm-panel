'use client'

import { useEffect, useState } from 'react'
import { Copy, Download, X } from 'lucide-react'
import PButton from '@/components/baseui/pbutton'
import PDiv from '@/components/baseui/pdiv'
import PixelSpinner from '@/components/baseui/spinner'
import { clientApiFetch } from '@/lib/api'
import { toast } from '@/components/baseui/toast-manager'

interface VPNConfig {
  vpn_ip: string
  public_key: string
  config: string
  created_at: string
}

interface VPNConfigModalProps {
  open: boolean
  onClose: () => void
  /** When true, shows a warning that VPN is required to access VMs */
  isFirstTime?: boolean
}

export default function VPNConfigModal({ open, onClose, isFirstTime }: VPNConfigModalProps) {
  const [config, setConfig] = useState<VPNConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    setConfig(null)

    clientApiFetch('/vpn/config')
      .then(setConfig)
      .catch(async (err: Error) => {
        // 404 means no config yet — generate one
        if (err.message?.includes('No VPN config found')) {
          try {
            const newCfg = await clientApiFetch('/vpn/config', { method: 'POST' })
            setConfig(newCfg)
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to generate VPN config')
          }
        } else {
          setError(err.message ?? 'Failed to load VPN config')
        }
      })
      .finally(() => setLoading(false))
  }, [open])

  const handleCopy = async () => {
    if (!config) return
    await navigator.clipboard.writeText(config.config)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('VPN config copied to clipboard')
  }

  const handleDownload = () => {
    if (!config) return
    const blob = new Blob([config.config], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'wg0.conf'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-lg">
        <PDiv fullWidth padding="p-6">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">WireGuard VPN Config</h2>
              {isFirstTime ? (
                <p className="mt-1 text-sm text-amber-400">
                  VPN is required to reach your VMs — save this config before closing.
                </p>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">
                  Your personal WireGuard client configuration.
                </p>
              )}
            </div>
            <button onClick={onClose} className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex justify-center py-8">
              <PixelSpinner color="bg-zinc-500" size={8} />
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <p className="py-4 text-sm text-red-400">{error}</p>
          )}

          {/* Config */}
          {!loading && config && (
            <>
              <div className="mb-3 flex gap-6 text-sm text-zinc-400">
                <span>
                  VPN IP:{' '}
                  <span className="font-mono text-zinc-200">{config.vpn_ip}</span>
                </span>
              </div>

              <div className="mb-3 overflow-auto max-h-52 border border-zinc-700 bg-zinc-950 p-3">
                <pre className="font-mono text-xs text-zinc-300 whitespace-pre">{config.config}</pre>
              </div>

              <p className="mb-4 text-xs text-zinc-500">
                Import this file into the WireGuard app on your device (
                <span className="text-zinc-400">wireguard.com</span>
                ). You can retrieve this config anytime from the header menu.
              </p>

              <div className="flex flex-wrap gap-2">
                <PButton variant="primary" customInnerClass="py-2 px-3" onClick={handleDownload}>
                  <Download className="mr-1.5 h-4 w-4 inline" />
                  Download wg0.conf
                </PButton>
                <PButton variant="secondary" customInnerClass="py-2 px-3" onClick={handleCopy}>
                  <Copy className="mr-1.5 h-4 w-4 inline" />
                  {copied ? 'Copied!' : 'Copy Config'}
                </PButton>
              </div>
            </>
          )}
        </PDiv>
      </div>
    </div>
  )
}
