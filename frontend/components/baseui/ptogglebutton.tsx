"use client";

import React, { useState } from 'react';

interface PToggleButtonProps {
	checked?: boolean;
	onChange?: (checked: boolean) => void;
	disabled?: boolean;
	variant?: 'primary' | 'secondary' | 'danger';
	size?: 'sm' | 'md' | 'lg';
	leftLabel?: string;
	rightLabel?: string;
	className?: string;
}

export default function PToggleButton({ 
	checked = false,
	onChange,
	disabled = false,
	variant = 'primary',
	size = 'md',
	leftLabel = 'OFF',
	rightLabel = 'ON',
	className = ''
}: PToggleButtonProps) {
	const [isToggled, setIsToggled] = useState(checked);

	const handleClick = () => {
		if (disabled) return;
		const newValue = !isToggled;
		setIsToggled(newValue);
		if (onChange) {
			onChange(newValue);
		}
	};

	const getSizeClasses = () => {
		// Calculate width based on text length
		const maxLabelLength = Math.max(leftLabel.length, rightLabel.length);
		const baseWidth = Math.max(maxLabelLength * 8 + 32, 80); // Minimum 80px
		
		switch (size) {
			case 'sm':
				return { 
					toggle: `h-6`, 
					knob: 'h-4', 
					text: 'text-xs',
					width: Math.max(baseWidth * 0.8, 64)
				};
			case 'md':
				return { 
					toggle: `h-7`, 
					knob: 'h-5', 
					text: 'text-sm',
					width: Math.max(baseWidth, 80)
				};
			case 'lg':
				return { 
					toggle: `h-8`, 
					knob: 'h-6', 
					text: 'text-base',
					width: Math.max(baseWidth * 1.2, 96)
				};
			default:
				return { 
					toggle: `h-7`, 
					knob: 'h-5', 
					text: 'text-sm',
					width: Math.max(baseWidth, 80)
				};
		}
	};

	const getVariantClasses = () => {
		const baseClasses = 'border-b-4 hover:border-b-6 border-r-4 hover:border-r-6 active:border-b-3 active:border-r-3 transition-all duration-75 ease-in';
		const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';
		
		switch (variant) {
			case 'primary':
				return `${baseClasses} ${isToggled ? 'border-blue-500 bg-blue-500' : 'border-zinc-500 bg-zinc-500'} ${disabledClasses}`;
			case 'secondary':
				return `${baseClasses} ${isToggled ? 'border-green-500 bg-green-500' : 'border-zinc-500 bg-zinc-500'} ${disabledClasses}`;
			case 'danger':
				return `${baseClasses} ${isToggled ? 'border-red-500 bg-red-500' : 'border-zinc-500 bg-zinc-500'} ${disabledClasses}`;
			default:
				return `${baseClasses} ${isToggled ? 'border-blue-500 bg-blue-500' : 'border-zinc-500 bg-zinc-500'} ${disabledClasses}`;
		}
	};

	const getBorderClasses = () => {
		switch (variant) {
			case 'primary':
				return isToggled ? 'border-blue-300' : 'border-zinc-300';
			case 'secondary':
				return isToggled ? 'border-green-300' : 'border-zinc-300';
			case 'danger':
				return isToggled ? 'border-red-300' : 'border-zinc-300';
			default:
				return isToggled ? 'border-blue-300' : 'border-zinc-300';
		}
	};

	const sizeClasses = getSizeClasses();

	return (
		<div
			onClick={handleClick}
			className={`${getVariantClasses()} ${sizeClasses.toggle} relative ${className}`}
			style={{
				width: `${sizeClasses.width}px`,
				clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px))'
			}}
		>
			<div 
				className={`border-4 ${getBorderClasses()} bg-zinc-900/85 w-full h-full relative overflow-hidden`}
				style={{
					clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))'
				}}
			>
				<div className="absolute inset-0 flex items-center z-10">
					<div className="flex-1 flex items-center justify-center px-1">
						<span className={`${sizeClasses.text} font-medium select-none transition-opacity duration-200 truncate ${
							!isToggled ? 'text-white opacity-100' : 'text-zinc-400 opacity-50'
						}`}>
							{leftLabel}
						</span>
					</div>
					<div className="flex-1 flex items-center justify-center px-1">
						<span className={`${sizeClasses.text} font-medium select-none transition-opacity duration-200 truncate ${
							isToggled ? 'text-white opacity-100' : 'text-zinc-400 opacity-50'
						}`}>
							{rightLabel}
						</span>
					</div>
				</div>
				<div 
					className={`${sizeClasses.knob} bg-zinc-500 backdrop-blur-sm transition-transform duration-200 ease-in-out absolute top-1 z-5`}
					style={{
						left: '4px',
						width: `${sizeClasses.width / 2 - 8}px`,
						transform: isToggled ? `translateX(${sizeClasses.width / 2}px)` : 'translateX(0)',
						clipPath: 'polygon(0 2px, 2px 2px, 2px 0, calc(100% - 2px) 0, calc(100% - 2px) 2px, 100% 2px, 100% calc(100% - 2px), calc(100% - 2px) calc(100% - 2px), calc(100% - 2px) 100%, 2px 100%, 2px calc(100% - 2px), 0 calc(100% - 2px))'
					}}
				/>
			</div>
		</div>
	);
}