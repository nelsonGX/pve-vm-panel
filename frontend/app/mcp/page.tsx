import type { Metadata } from 'next'
import McpPageClient from './McpPageClient'

export const metadata: Metadata = {
  title: 'AI Agents (MCP) | Nelson\'s Free VM',
  description: 'Connect AI agents to your VM account with the Model Context Protocol.',
}

export default function McpPage() {
  return <McpPageClient />
}
