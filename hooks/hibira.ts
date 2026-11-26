import type { ToolInfo, McpToolResult } from 'claude-code'

import type { AppRow, Snapshot, Workspace } from '../types'

const TOOL = /^mcp__(.+)__([a-z_]+)$/

export const INBOX_URL = 'https://approvals.hibira.io/inbox'
export const PORTAL_URL = 'https://hibira.io/portal/dashboard'
export const SETUP_URL = 'https://github.com/hibira-io/agent-plugin#claude-code'

// The Hibira MCP server is the one whose tools include both get_account and
// list_apps. It may be connected under any name: the agent plugin's
// ("plugin_hibira_hibira"), a claude.ai connector ("claude_ai_Hibira") or a
// server the person added by hand.
export function findServer(tools: readonly ToolInfo[]): string | undefined {
  const byServer = new Map<string, Set<string>>()
  for (const tool of tools) {
    if (!tool.mcp) continue
    const match = TOOL.exec(tool.name)
    if (!match) continue
    const [, server, name] = match
    if (server === undefined || name === undefined) continue
    const names = byServer.get(server) ?? new Set<string>()
    names.add(name)
    byServer.set(server, names)
  }
  const candidates = [...byServer.entries()]
    .filter(([, names]) => names.has('get_account') && names.has('list_apps'))
    .map(([server]) => server)

  return candidates.find(server => /hibira/i.test(server)) ?? candidates[0]
}

export function isHibiraTool(name: string, server: string | undefined): boolean {
  return server !== undefined && name.startsWith(`mcp__${server}__`)
}

export function readJson(result: McpToolResult): unknown {
  if (result.isError) {
    throw new Error(textOf(result) || 'the Hibira tool failed')
  }
  if (result.structuredContent !== undefined) return result.structuredContent

  return JSON.parse(textOf(result))
}

function textOf(result: McpToolResult): string {
  return result.content
    .map(block => (block.type === 'text' && 'text' in block ? String(block.text) : ''))
    .join('')
}

type Obj = Record<string, unknown>

function obj(value: unknown): Obj {
  return typeof value === 'object' && value !== null ? (value as Obj) : {}
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function toSnapshot(args: {
  account: unknown
  apps: unknown
  workspaces: unknown
  at: number
}): Snapshot {
  const account = obj(args.account)
  const plan = obj(account.plan)
  const limits = obj(plan.limits)
  const usage = obj(account.usage)
  const apps: AppRow[] = (Array.isArray(obj(args.apps).apps) ? (obj(args.apps).apps as unknown[]) : [])
    .map(raw => {
      const app = obj(raw)
      const today = obj(app.usage_today)

      return {
        id: str(app.id),
        name: str(app.name) || str(app.id),
        isEnabled: app.enabled !== false,
        connections: num(today.connections),
        messages: num(today.messages_today),
        url: str(app.portal_url) || PORTAL_URL,
      }
    })
    .filter(app => app.id !== '')
  const workspaces: Workspace[] = (
    Array.isArray(obj(args.workspaces).items) ? (obj(args.workspaces).items as unknown[]) : []
  )
    .map(raw => {
      const ws = obj(raw)

      return { id: str(ws.id), name: str(ws.name) || str(ws.id), pending: num(ws.pending) }
    })
    .filter(ws => ws.id !== '')

  return {
    isConnected: true,
    plan: str(plan.name) || str(plan.id),
    connections: num(usage.connections),
    connectionLimit: num(limits.connections),
    messages: num(usage.messages_today),
    messageLimit: num(limits.daily_messages),
    apps,
    workspaces,
    pending: workspaces.reduce((sum, ws) => sum + ws.pending, 0),
    updatedAt: args.at,
  }
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (n >= 10_000) return `${trim(n / 1_000)}k`

  return n.toLocaleString('en-US')
}

function trim(n: number): string {
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '')
}

export function statusLine(s: Snapshot): string | undefined {
  if (!s.isConnected) return undefined
  const parts = [`${compact(s.connections)} live`, `${compact(s.messages)} msgs today`]
  if (s.pending > 0) {
    parts.push(`${s.pending} approval${s.pending === 1 ? '' : 's'} waiting`)
  }

  return `Hibira · ${parts.join(' · ')}`
}
