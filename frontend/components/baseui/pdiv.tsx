import React from 'react';

interface PDivProps {
	children: React.ReactNode;
	minWidth?: string;
	shadowColor?: string;
	borderColor?: string;
	className?: string;
	animated?: boolean;
}

export default function PDiv({ children, minWidth, shadowColor = 'zinc-500', borderColor = 'zinc-300', className = '', animated = false }: PDivProps) {
	return (
		<div className={`border-b-4 border-r-4 border-${shadowColor} bg-${shadowColor} max-w-fit max-h-fit ${className} ${animated ? 'hover:border-b-6 hover:border-r-6 hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-75 ease-in' : ''}`}
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
				<div className="p-4">
					{children}
				</div>
			</div>
		</div>
	);
}