"use client";

import Image from "next/image";
import React from "react";

interface ImageButtonProps {
	imageSrc: string;
	imageAlt: string;
	title: string;
	description?: string;
	onClick: () => void;
	disabled?: boolean;
	className?: string;
}

export default function ImageButton({
	imageSrc,
	imageAlt,
	title,
	description,
	onClick,
	disabled = false,
	className = ""
}: ImageButtonProps) {
	const isButtonDisabled = disabled;

	const getClasses = () => {
		const baseClasses = [
			'border-b-4 hover:border-b-6 border-r-4 hover:border-r-6',
			'hover:-translate-y-0.5 hover:-translate-x-0.5',
			'active:border-b-3 active:border-r-3 active:translate-y-0.5 active:mb-0.5 active:translate-x-0.5',
			'transition-all duration-75 ease-in max-w-fit max-h-fit aspect-square'
		].filter(Boolean).join(' ');
		const disabledClasses = isButtonDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';
		return `${baseClasses} border-zinc-500 bg-zinc-500 ${disabledClasses}`;
	};

	return (
		<button
			onClick={onClick}
			disabled={isButtonDisabled}
			className={`${getClasses()} ${className}`}
			style={{
				clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px))'
			}}
		>
			<div className="border-4 border-zinc-300 bg-zinc-900/85"
				style={{
					clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))'
				}}
			>
				<div className="relative w-full h-full overflow-hidden">
					<Image 
						src={imageSrc} 
						alt={imageAlt}
						width={256}
						height={256}
						unoptimized
						className="w-full h-full object-cover"
					/>
					<div className="absolute inset-0 bg-black/40 flex flex-col justify-end p-4">
						<div className="text-center">
							<p className="text-sm font-semibold text-white drop-shadow-lg">
								{title}
							</p>
							{description && (
								<p className="text-xs text-zinc-200 mt-1 drop-shadow">
									{description}
								</p>
							)}
						</div>
					</div>
				</div>
			</div>
		</button>
	);
}