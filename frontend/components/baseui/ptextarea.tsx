import React from 'react';

interface PTextareaProps {
	id?: string;
	ariaLabel?: string;
	value?: string;
	onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
	placeholder?: string;
	disabled?: boolean;
	required?: boolean;
	rows?: number;
	cols?: number;
	minWidth?: string;
	shadowColor?: string;
	borderColor?: string;
	className?: string;
}

export default function PTextarea({ 
	id,
	ariaLabel,
	value, 
	onChange, 
	placeholder, 
	disabled = false, 
	required = false,
	rows = 4,
	cols,
	minWidth, 
	shadowColor = 'zinc-500', 
	borderColor = 'zinc-300', 
	className = '' 
}: PTextareaProps) {
	return (
		<div className={`border-b-4 hover:border-b-6 border-r-4 hover:border-r-6 border-${shadowColor} bg-${shadowColor} hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-75 ease-in max-w-fit max-h-fit ${className}`}
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
				<textarea
					id={id}
					aria-label={ariaLabel}
					value={value}
					onChange={onChange}
					placeholder={placeholder}
					disabled={disabled}
					required={required}
					rows={rows}
					cols={cols}
					className="w-full bg-transparent text-white placeholder-zinc-400 outline-none p-4 resize-none"
				/>
			</div>
		</div>
	);
}
