"use client"

import React, { createContext, useContext, useState, useCallback } from 'react';
import PToast from './ptoast';

interface Toast {
  id: string;
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
  autoClose?: boolean;
  autoCloseDelay?: number;
}

interface ToastContextType {
  showToast: (message: string, variant?: 'info' | 'success' | 'warning' | 'error', options?: Partial<Toast>) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((
    message: string, 
    variant: 'info' | 'success' | 'warning' | 'error' = 'info',
    options: Partial<Toast> = {}
  ) => {
    const id = Date.now().toString();
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

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.map(toast => (
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
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

// Easy global function (can be used anywhere without hooks)
let globalShowToast: ((message: string, variant?: 'info' | 'success' | 'warning' | 'error', options?: Partial<Toast>) => void) | null = null;

export const setGlobalToastFunction = (fn: (message: string, variant?: 'info' | 'success' | 'warning' | 'error', options?: Partial<Toast>) => void) => {
  globalShowToast = fn;
};

export const toast = {
  info: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'info', options),
  success: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'success', options),
  warning: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'warning', options),
  error: (message: string, options?: Partial<Toast>) => globalShowToast?.(message, 'error', options),
  show: (message: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info', options?: Partial<Toast>) => 
    globalShowToast?.(message, variant, options)
};