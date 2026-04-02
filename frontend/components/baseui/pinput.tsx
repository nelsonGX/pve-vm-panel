"use client";

import React, { useState } from 'react';

interface PInputProps {
	value?: string;
	onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
	type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
	placeholder?: string;
	disabled?: boolean;
	required?: boolean;
	minWidth?: string;
	shadowColor?: string;
	borderColor?: string;
	className?: string;
}

export default function PInput({ 
	value, 
	onChange, 
	type = 'text', 
	placeholder, 
	disabled = false, 
	required = false,
	minWidth, 
	shadowColor = 'zinc-500', 
	borderColor = 'zinc-300', 
	className = '' 
}: PInputProps) {
	const [isPressed, setIsPressed] = useState(false);

	return (
		<div 
			className={`border-b-4 hover:border-b-6 border-r-4 hover:border-r-6 border-${shadowColor} bg-${shadowColor} hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-75 ease-in max-w-fit max-h-fit ${
				isPressed ? 'bg-black' : ''
			} ${className}`}
			style={{
				clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px))',
				minWidth: minWidth
			}}
		>
			<div className={`border-4 border-${borderColor} bg-zinc-900/85`}
				style={{
					clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))'
				}}
			>
				<input
					type={type}
					value={value}
					onChange={onChange}
					placeholder={placeholder}
					disabled={disabled}
					required={required}
					onMouseDown={() => setIsPressed(true)}
					onMouseUp={() => setIsPressed(false)}
					onMouseLeave={() => setIsPressed(false)}
					onFocus={() => setIsPressed(true)}
					onBlur={() => setIsPressed(false)}
					className="w-full bg-transparent text-white placeholder-zinc-400 outline-none py-2 px-3"
				/>
			</div>
		</div>
	);
}