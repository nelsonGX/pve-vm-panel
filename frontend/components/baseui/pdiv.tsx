import React from 'react';

interface PDivProps {
	children: React.ReactNode;
	minWidth?: string;
	shadowColor?: string;
	borderColor?: string;
	className?: string;
	innerClassName?: string;
	style?: React.CSSProperties;
	animated?: boolean;
	fullWidth?: boolean;
	padding?: string;
}

export default function PDiv({
	children,
	minWidth,
	shadowColor = 'zinc-500',
	borderColor = 'zinc-300',
	className = '',
	innerClassName = '',
	style,
	animated = false,
	fullWidth = false,
	padding = 'p-4',
}: PDivProps) {
	const sizeClass = fullWidth ? 'w-full' : 'max-w-fit max-h-fit';
	return (
		<div
			className={`border-b-4 border-r-4 border-${shadowColor} bg-${shadowColor} ${sizeClass} ${className} ${animated ? 'hover:border-b-6 hover:border-r-6 hover:-translate-x-0.5 hover:-translate-y-0.5 transition-all duration-75 ease-in' : ''}`}
			style={{
				clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px))',
				minWidth: minWidth,
				...style
			}}
		>
			<div
				className={`border-4 border-${borderColor} bg-zinc-900/85 ${fullWidth ? 'w-full' : ''} ${innerClassName}`}
				style={{
					clipPath: 'polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))'
				}}
			>
				<div className={padding}>
					{children}
				</div>
			</div>
		</div>
	);
}
