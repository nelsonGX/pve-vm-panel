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
	fullWidth?: boolean;
}

const OUTER_CLIP_PATH = 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px))';
const INNER_CLIP_PATH = 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))';

export default function PButton(props: PButtonProps) {
	const {
		children,
		onClick,
		type = 'button',
		disabled = false,
		variant = 'primary',
		minWidth,
		className = '',
		spinnerAfterClick = false,
		disableAfterClick = false,
		spinnerColor = 'bg-white',
		spinnerTimeout = 10000,
		loading = false,
		customInnerClass = "pb-1 pt-0.5",
		fullWidth = false,
	} = props;

	const [isClicked, setIsClicked] = useState(false);
	const [temporarilyDisabled, setTemporarilyDisabled] = useState(false);

	const isButtonDisabled = temporarilyDisabled || disabled || loading;
	const shouldShowSpinner = (spinnerAfterClick && isClicked) || loading;

	const getClasses = () => {
		const baseClasses = [
			'group relative inline-block border-0 bg-transparent p-0 text-left align-top',
			'transition-opacity duration-75 ease-in',
			fullWidth ? 'w-full' : 'max-w-fit max-h-fit'
		].filter(Boolean).join(' ');
		const disabledClasses = isButtonDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

		return `${baseClasses} ${disabledClasses}`;
	};

	const getShadowClasses = () => {
		switch (variant) {
			case 'primary':
				return 'bg-blue-500';
			case 'secondary':
				return 'bg-zinc-500';
			case 'danger':
				return 'bg-red-500';
			case 'gray':
				return 'bg-zinc-700';
			default:
				return 'bg-zinc-500';
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
			setTemporarilyDisabled(true);
			setTimeout(() => {
				setTemporarilyDisabled(false);
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
				minWidth: minWidth
			}}
		>
			<div className={`relative ${fullWidth ? 'w-full' : 'max-w-fit max-h-fit'} pr-1.5 pb-1.5`}>
				<div
					aria-hidden="true"
					className={`absolute inset-0 ${getShadowClasses()}`}
					style={{
						clipPath: OUTER_CLIP_PATH,
					}}
				/>
				<div
					className={[
						'relative z-10 transition-transform duration-75 ease-in',
						'translate-x-0.5 translate-y-0.5',
						isButtonDisabled && 'cursor-not-allowed opacity-75',
						!isButtonDisabled && 'group-hover:translate-x-0 group-hover:translate-y-0 group-active:translate-x-0.75 group-active:translate-y-0.75',
						fullWidth && 'w-full'
					].filter(Boolean).join(' ')}
				>
					<div
						className={`border-4 ${getBorderClasses()} bg-zinc-900/85 ${fullWidth ? 'w-full' : ''}`}
						style={{
							clipPath: INNER_CLIP_PATH
						}}
					>
						<div className={`${customInnerClass} px-4 flex space-x-2 items-center justify-center text-lg`}>
							{shouldShowSpinner && <PixelSpinner color={spinnerColor} />}<span>{children}</span>
						</div>
					</div>
				</div>
			</div>
		</button>
	);
}
