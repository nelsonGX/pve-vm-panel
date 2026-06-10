import type { Toast, ToastVariant } from './toast-manager'

let globalShowToast:
  | ((message: string, variant?: ToastVariant, options?: Partial<Toast>) => void)
  | null = null

export const setGlobalToastFunction = (
  fn: (message: string, variant?: ToastVariant, options?: Partial<Toast>) => void,
) => {
  globalShowToast = fn
}

export const toast = {
  info: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'info', options),
  success: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'success', options),
  warning: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'warning', options),
  error: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'error', options),
  show: (message: string, variant: ToastVariant = 'info', options?: Partial<Toast>) =>
    globalShowToast?.(message, variant, options),
}
