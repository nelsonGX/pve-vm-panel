"use client"

import { useEffect } from 'react';
import { useToast } from './toast-manager';
import { setGlobalToastFunction } from './toast-api';

export const ToastSetup = () => {
  const { showToast } = useToast();

  useEffect(() => {
    setGlobalToastFunction(showToast);
  }, [showToast]);

  return null;
};
