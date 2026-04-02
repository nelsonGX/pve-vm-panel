"use client";

import React, { useState } from 'react';

import PixelSpinner from './spinner';

interface PButtonProps {
	children: React.ReactNode;
	onClick?: () => void;
	type?: 'button' | 'submit' | 'reset';
	disabled?: boolean;
	variant?: 'primary' | 'secondary' | 'danger' | 'gray';
	minWidth?: string;
	shadowColor?: string;
	borderColor?: string;
	className?: string;
	disableFixedPaddingX?: boolean;
	disableFixedPaddingY?: boolean;
	spinnerAfterClick?: boolean;
	disableAfterClick?: boolean;
	spinnerColor?: string;
	spinnerTimeout?: number;
	loading?: boolean;
	customInnerClass?: string;
}

export default function PButton({ 
	children, 
	onClick, 
	type = 'button', 
	disabled = false, 
	variant = 'primary',
	minWidth,
	className = '',
	disableFixedPaddingX = false,
	disableFixedPaddingY = false,
	spinnerAfterClick = false,
	disableAfterClick = false,
	spinnerColor = 'bg-white',
	spinnerTimeout = 10000,
	loading = false,
	customInnerClass = "py-2"
}: PButtonProps) {
	const [isClicked, setIsClicked] = useState(false);
	const [isDisabled, setIsDisabled] = useState(disabled);
	
	const isButtonDisabled = isDisabled || disabled || loading;
	const shouldShowSpinner = (spinnerAfterClick && isClicked) || loading;

	const getClasses = () => {
		const baseClasses = [
			'border-b-4 hover:border-b-6 border-r-4 hover:border-r-6',
			'active:border-b-3 active:border-r-3',
			'transition-all duration-75 ease-in max-w-fit max-h-fit',
			!disableFixedPaddingY && 'hover:-translate-y-0.5 hover:-mb-0.5 active:translate-y-0.5 active:mb-0.5',
			!disableFixedPaddingX && 'hover:mr-[13.9px] hover:-translate-x-0.5 active:mr-4 active:translate-x-0.5'
		].filter(Boolean).join(' ');
		const disabledClasses = isButtonDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';
		
		switch (variant) {
			case 'primary':
				return `${baseClasses} border-blue-500 bg-blue-500 ${disabledClasses}`;
			case 'secondary':
				return `${baseClasses} border-zinc-500 bg-zinc-500 ${disabledClasses}`;
			case 'danger':
				return `${baseClasses} border-red-500 bg-red-500 ${disabledClasses}`;
			case 'gray':
				return `${baseClasses} border-zinc-700 bg-zinc-700 ${disabledClasses}`;
			default:
				return `${baseClasses} border-zinc-500 bg-zinc-500 ${disabledClasses}`;
		}
	};

	const getBorderClasses = () => {
		switch (variant) {
			case 'primary':
				return 'border-blue-300';
			case 'secondary':
				return 'border-zinc-300';
			case 'danger':
				return 'border-red-300';
			case 'gray':
				return 'border-zinc-400';
			default:
				return 'border-zinc-300';
		}
	};

	const onClickEvent = () => {
		if (isButtonDisabled) return;
		setIsClicked(true);
		if (onClick) {
			onClick();
		}
		if (disableAfterClick) {
			setIsDisabled(true);
			setTimeout(() => {
				setIsDisabled(false);
				setIsClicked(false);
			}, spinnerTimeout);
		} else {
			setTimeout(() => {
				setIsClicked(false);
			}, spinnerTimeout);
		}
	};

	return (
		<button
			type={type}
			onClick={onClickEvent}
			disabled={isButtonDisabled}
			className={`${getClasses()} ${className}`}
			style={{
				clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px))',
				minWidth: minWidth
			}}
		>
			<div className={`border-4 ${getBorderClasses()} bg-zinc-900/85`}
				style={{
					clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))'
				}}
			>
				<div className={`${customInnerClass} px-4 flex space-x-2 items-center justify-center`}>
					{shouldShowSpinner && <PixelSpinner color={spinnerColor} />}<span>{children}</span>
				</div>
			</div>
		</button>
	);
}