"use client"

import React from 'react';

interface IconProps {
	name: 'alert' | 'check' | 'error' | 'info' | 'dropdown' | 'dropup' | 'google' | 'passkey' | 'passkeybold' | 'userprofile' | 'discord' | 'github' | 'message' | 'logout' | 'add' | 'server' | 'money' | 'rightarrow' | 'minecraft' | 'rust' | 'palworld' | 'survival' | 'plugins' | 'mods' | 'minigames' | 'cpu' | 'ram' | 'disk' | 'shield' | 'backup' | 'location' | 'creative' | 'prison' | 'custom' | 'bell' | 'addbulk';
	size?: number;
	color?: string;
	className?: string;
}

const iconPaths = {
	alert: '/assets/icons/alert.svg',
	check: '/assets/icons/check.svg',
	error: '/assets/icons/error.svg',
	info: '/assets/icons/info.svg',
	dropdown: '/assets/icons/dropdown.svg',	
	dropup: '/assets/icons/dropup.svg',
	google: '/assets/icons/google.svg',
	passkey: '/assets/icons/passkey.svg',
	passkeybold: '/assets/icons/passkeybold.svg',
	userprofile: '/assets/icons/userprofile.svg',
	discord: '/assets/icons/discord.svg',
	github: '/assets/icons/github.svg',
	message: '/assets/icons/message.svg',
	logout: '/assets/icons/logout.svg',
	add: '/assets/icons/add.svg',
	server: '/assets/icons/server.svg',
	money: '/assets/icons/money.svg',
	rightarrow: '/assets/icons/rightarrow.svg',
	minecraft: '/assets/icons/minecraft.svg',
	rust: '/assets/icons/rust.svg',
	palworld: '/assets/icons/palworld.svg',
	survival: '/assets/icons/survival.svg',
	plugins: '/assets/icons/plugins.svg',
	mods: '/assets/icons/mods.svg',
	minigames: '/assets/icons/minigames.svg',
	cpu: '/assets/icons/cpu.svg',
	ram: '/assets/icons/ram.svg',
	disk: '/assets/icons/disk.svg',
	shield: '/assets/icons/shield.svg',
	backup: '/assets/icons/backup.svg',
	location: '/assets/icons/location.svg',
	creative: '/assets/icons/creative.svg',
	prison: '/assets/icons/prison.svg',
	custom: '/assets/icons/custom.svg',
	bell: '/assets/icons/bell.svg',
	addbulk: '/assets/icons/addbulk.svg',
};

// Global cache for SVG content
const svgCache = new Map<string, string>();
const loadingPromises = new Map<string, Promise<string>>();

async function loadAndCacheSvg(name: keyof typeof iconPaths): Promise<string> {
	const cacheKey = name;
	
	// Return from cache if available
	if (svgCache.has(cacheKey)) {
		return svgCache.get(cacheKey)!;
	}
	
	// Return existing promise if already loading
	if (loadingPromises.has(cacheKey)) {
		return loadingPromises.get(cacheKey)!;
	}
	
	// Create new loading promise
	const loadingPromise = (async () => {
		try {
			const response = await fetch(iconPaths[name]);
			if (!response.ok) throw new Error('Failed to load SVG');
			
			const svgText = await response.text();
			svgCache.set(cacheKey, svgText);
			loadingPromises.delete(cacheKey);
			return svgText;
		} catch (error) {
			loadingPromises.delete(cacheKey);
			throw error;
		}
	})();
	
	loadingPromises.set(cacheKey, loadingPromise);
	return loadingPromise;
}

function processSvg(svgText: string, size: number, color: string): string {
	// Replace fill colors with the desired color
	let processedSvg = svgText;
	if (color !== 'currentColor') {
		processedSvg = processedSvg.replace(/fill="#[^"]*"/g, `fill="${color}"`);
	} else {
		processedSvg = processedSvg.replace(/fill="#[^"]*"/g, 'fill="currentColor"');
	}
	
	// Update viewBox to make it scalable
	const parser = new DOMParser();
	const svgDoc = parser.parseFromString(processedSvg, 'image/svg+xml');
	const svgElement = svgDoc.querySelector('svg');
	
	if (svgElement) {
		svgElement.setAttribute('width', size.toString());
		svgElement.setAttribute('height', size.toString());
		return new XMLSerializer().serializeToString(svgElement);
	}
	
	return processedSvg;
}

export default function Icon({ name, size = 24, color = 'currentColor', className = '' }: IconProps) {
	const [svgContent, setSvgContent] = React.useState<string>('');
	const [isLoading, setIsLoading] = React.useState(true);

	React.useEffect(() => {
		const loadIcon = async () => {
			try {
				setIsLoading(true);
				const rawSvg = await loadAndCacheSvg(name);
				const processedSvg = processSvg(rawSvg, size, color);
				setSvgContent(processedSvg);
			} catch (error) {
				console.error(`Failed to load icon ${name}:`, error);
				setSvgContent('');
			} finally {
				setIsLoading(false);
			}
		};

		loadIcon();
	}, [name, size, color]);

	if (isLoading) {
		return (
			<div 
				className={`inline-block ${className}`} 
				style={{ width: size, height: size }}
			>
				<div className="w-full h-full bg-zinc-600 animate-pulse rounded"></div>
			</div>
		);
	}

	if (!svgContent) {
		return (
			<div 
				className={`inline-block bg-zinc-800 ${className}`} 
				style={{ width: size, height: size }}
			>
				?
			</div>
		);
	}

	return (
		<div 
			className={`inline-block ${className}`}
			dangerouslySetInnerHTML={{ __html: svgContent }}
		/>
	);
}