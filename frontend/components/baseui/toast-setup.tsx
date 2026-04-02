"use client"

import { useEffect } from 'react';
import { useToast, setGlobalToastFunction } from './toast-manager';

export const ToastSetup = () => {
  const { showToast } = useToast();

  useEffect(() => {
    setGlobalToastFunction(showToast);
  }, [showToast]);

  return null;
};