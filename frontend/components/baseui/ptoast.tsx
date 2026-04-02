"use client"

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Icon from './icon';

const EXIT_ANIMATION_MS = 400;

interface PToastProps {
	children: React.ReactNode;
	variant?: 'info' | 'success' | 'warning' | 'error';
	onClose?: () => void;
	autoClose?: boolean;
	autoCloseDelay?: number;
	position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';
	className?: string;
	isVisible?: boolean;
}

export default function PToast({
	children,
	variant = 'info',
	onClose,
	autoClose = true,
	autoCloseDelay = 3000,
	position = 'top-right',
	className = '',
	isVisible = true
}: PToastProps) {
	const [isClosing, setIsClosing] = useState(false);
	const isClosingRef = useRef(false);
	const onCloseRef = useRef(onClose);
	useEffect(() => { onCloseRef.current = onClose; });

	const handleClose = useCallback(() => {
		if (isClosingRef.current) return;
		isClosingRef.current = true;
		setIsClosing(true);
		window.setTimeout(() => {
			onCloseRef.current?.();
		}, EXIT_ANIMATION_MS);
	}, []);

	useEffect(() => {
		if (!autoClose) return;
		const timer = setTimeout(handleClose, autoCloseDelay);
		return () => clearTimeout(timer);
	}, [autoClose, autoCloseDelay, handleClose]);

	const getClasses = () => {
		const baseClasses = "border-b-4 hover:border-b-6 border-r-4 hover:border-r-6 hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-75 ease-in max-w-fit max-h-fit";
		
		switch (variant) {
			case 'info':
				return `${baseClasses} border-blue-400 bg-blue-400`;
			case 'success':
				return `${baseClasses} border-green-500 bg-green-500`;
			case 'warning':
				return `${baseClasses} border-yellow-600 bg-yellow-600`;
			case 'error':
				return `${baseClasses} border-red-600 bg-red-600`;
			default:
				return `${baseClasses} border-zinc-500 bg-zinc-500`;
		}
	};

	const getBorderClasses = () => {
		switch (variant) {
			case 'info':
				return 'border-blue-200';
			case 'success':
				return 'border-green-300';
			case 'warning':
				return 'border-yellow-300';
			case 'error':
				return 'border-red-300';
			default:
				return 'border-zinc-300';
		}
	};

	const getIconName = () => {
		switch (variant) {
			case 'info':
				return 'info';
			case 'success':
				return 'check';
			case 'warning':
				return 'alert';
			case 'error':
				return 'error';
			default:
				return 'info';
		}
	};

	const getIconColor = () => {
		switch (variant) {
			case 'info':
				return 'oklch(88.2% 0.1 254.128)';	
			case 'success':
				return '#22c55e';
			case 'warning':
				return '#f59e0b';
			case 'error':
				return '#ef4444';				
			default:
				return '';
		}
	};

	const getAnimationClasses = () => {
		switch (position) {
			case 'top-right':
			case 'bottom-right':
				return isClosing ? 'animate-toast-out-right' : 'animate-toast-in-right';
			case 'top-left':
			case 'bottom-left':
				return isClosing ? 'animate-toast-out-left' : 'animate-toast-in-left';
			case 'top-center':
				return isClosing ? 'animate-toast-out-up' : 'animate-toast-in-down';
			case 'bottom-center':
				return isClosing ? 'animate-toast-out-down' : 'animate-toast-in-up';
			default:
				return isClosing ? 'animate-toast-out-right' : 'animate-toast-in-right';
		}
	};

	if (!isVisible) return null;

	return (
		<div className={`${getAnimationClasses()} pointer-events-auto`}>
			<div className={`${getClasses()} ${className}`}
				style={{
					clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px))'
				}}
			>
				<div className={`border-4 ${getBorderClasses()} bg-zinc-900/85`}
					style={{
						clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))'
					}}
				>
					<div className="py-3 px-4 flex items-center gap-3 min-w-75">
						<Icon name={getIconName() as 'alert' | 'check' | 'error' | 'info'} size={20} color={getIconColor()} />
						<div className="flex-1">
							{children}
						</div>
						<button
							onClick={handleClose}
							className="text-zinc-400 hover:text-white transition-colors ml-2"
						>
							×
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
