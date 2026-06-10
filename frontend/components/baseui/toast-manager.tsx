"use client"

import React, { createContext, use, useCallback, useMemo, useState } from 'react';
import PToast from './ptoast';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  autoClose?: boolean;
  autoCloseDelay?: number;
}

interface ToastContextType {
  showToast: (message: string, variant?: ToastVariant, options?: Partial<Toast>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_POSITIONS: NonNullable<Toast['position']>[] = [
  'top-right',
  'top-left',
  'bottom-right',
  'bottom-left',
  'top-center',
  'bottom-center',
];

function getContainerClasses(position: NonNullable<Toast['position']>) {
  switch (position) {
    case 'top-right':
      return 'fixed top-4 right-4 z-[9999] flex flex-col items-end gap-3 pointer-events-none';
    case 'top-left':
      return 'fixed top-4 left-4 z-[9999] flex flex-col items-start gap-3 pointer-events-none';
    case 'bottom-right':
      return 'fixed bottom-4 right-4 z-[9999] flex flex-col-reverse items-end gap-3 pointer-events-none';
    case 'bottom-left':
      return 'fixed bottom-4 left-4 z-[9999] flex flex-col-reverse items-start gap-3 pointer-events-none';
    case 'top-center':
      return 'fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-3 pointer-events-none';
    case 'bottom-center':
      return 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse items-center gap-3 pointer-events-none';
    default:
      return 'fixed top-4 right-4 z-[9999] flex flex-col items-end gap-3 pointer-events-none';
  }
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((
    message: string, 
    variant: ToastVariant = 'info',
    options: Partial<Toast> = {}
  ) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newToast: Toast = {
      id,
      message,
      variant,
      position: options.position || 'top-right',
      autoClose: options.autoClose !== false,
      autoCloseDelay: options.autoCloseDelay || 5000,
      ...options
    };
    
    setToasts(prev => [...prev, newToast]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {TOAST_POSITIONS.map((position) => {
        const positionedToasts = toasts.filter((toast) => (toast.position || 'top-right') === position);
        if (positionedToasts.length === 0) return null;

        return (
          <div key={position} className={getContainerClasses(position)}>
            {positionedToasts.map((toast) => (
              <PToast
                key={toast.id}
                variant={toast.variant}
                position={toast.position}
                autoClose={toast.autoClose}
                autoCloseDelay={toast.autoCloseDelay}
                isVisible={true}
                onClose={() => removeToast(toast.id)}
              >
                {toast.message}
              </PToast>
            ))}
          </div>
        );
      })}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = use(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
