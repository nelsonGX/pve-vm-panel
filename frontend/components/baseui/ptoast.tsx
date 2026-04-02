"use client"

import React, { useEffect, useState, useCallback } from 'react';
import Icon from './icon';

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
	autoCloseDelay = 5000,
	position = 'top-right',
	className = '',
	isVisible = true
}: PToastProps) {
	const [visible, setVisible] = useState(isVisible);

	useEffect(() => {
		setVisible(isVisible);
	}, [isVisible]);

	const handleClose = useCallback(() => {
		setVisible(false);
		if (onClose) {
			onClose();
		}
	}, [onClose]);

	useEffect(() => {
		if (autoClose && visible) {
			const timer = setTimeout(() => {
				handleClose();
			}, autoCloseDelay);
			
			return () => clearTimeout(timer);
		}
	}, [autoClose, autoCloseDelay, visible, handleClose]);

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

	const getPositionClasses = () => {
		switch (position) {
			case 'top-right':
				return 'fixed top-4 right-4 z-50';
			case 'top-left':
				return 'fixed top-4 left-4 z-50';
			case 'bottom-right':
				return 'fixed bottom-4 right-4 z-50';
			case 'bottom-left':
				return 'fixed bottom-4 left-4 z-50';
			case 'top-center':
				return 'fixed top-4 left-1/2 transform -translate-x-1/2 z-50';
			case 'bottom-center':
				return 'fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50';
			default:
				return 'fixed top-4 right-4 z-50';
		}
	};

	if (!visible) return null;

	return (
		<div className={`${getPositionClasses()} animate-in slide-in-from-right-5 duration-300`}>
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