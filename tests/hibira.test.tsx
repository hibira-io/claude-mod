import { expect, mock, test } from 'claude-code/testing'

import { findServer, statusLine, toSnapshot } from '../hooks/hibira'

const PANE = {
  plugin: 'hibira-mod',
  component: 'Pane',
  requestId: 'hibira',
  props: {
    title: 'Hibira',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const RUN = {
  command: 'hibira',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const ACCOUNT = {
  plan: { id: 'pro', name: 'Pro', limits: { connections: 5000, daily_messages: 10000000 } },
  usage: { connections: 1240, messages_today: 48210 },
}
const APPS = {
  apps: [
    {
      id: 'app_1',
      name: 'Storefront',
      enabled: true,
      usage_today: { connections: 1200, messages_today: 48000 },
      portal_url: 'https://hibira.io/portal/apps/app_1',
    },
    { id: 'app_2', name: 'Staging', enabled: false, usage_today: { connections: 40, messages_today: 210 } },
  ],
}
const WORKSPACES = { items: [{ id: 'aw_1', name: 'Deploys', pending: 2 }] }

function tool(name: string) {
  return { name, description: '', mcp: true }
}

function text(value: unknown) {
  return { value: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } }
}

test('the Hibira server is found under any name', () => {
  expect(
    findServer([
      tool('mcp__plugin_hibira_gaya__ask'),
      tool('mcp__plugin_hibira_hibira-live-chat__list_workspaces'),
      tool('mcp__claude_ai_Hibira__get_account'),
      tool('mcp__claude_ai_Hibira__list_apps'),
    ]),
  ).toBe('claude_ai_Hibira')
  expect(findServer([tool('mcp__other__get_account')])).toBe(undefined)
})

test('the status line counts live connections, messages and approvals', () => {
  const s = toSnapshot({ account: ACCOUNT, apps: APPS, workspaces: WORKSPACES, at: 0 })
  expect(statusLine(s)).toBe('Hibira · 1,240 live · 48.2k msgs today · 2 approvals waiting')
  expect(statusLine({ isConnected: false, updatedAt: 0 })).toBe(undefined)
})

test('/hibira opens a pane with the account, apps and approvals', async ($, on) => {
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'hibira' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.list', () => ({
    value: [
      tool('mcp__plugin_hibira_hibira__get_account'),
      tool('mcp__plugin_hibira_hibira__list_apps'),
      tool('mcp__plugin_hibira_hibira__api_get'),
    ],
  }))
  on('mcp.call', (_, e) => {
    expect(e.server).toBe('plugin_hibira_hibira')
    if (e.tool === 'get_account') return text(ACCOUNT)
    if (e.tool === 'list_apps') return text(APPS)

    return text(WORKSPACES)
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run(RUN)
  expect(ran.text).toBe('Hibira pane opened.')
  expect(statuses.at(-1)).toBe('Hibira · 1,240 live · 48.2k msgs today · 2 approvals waiting')
  expect(toasts).toEqual(['Hibira: 2 approvals waiting for you'])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Pro plan/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Storefront/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 waiting for you/ })).toBeDefined()
    await ui.unmount()
  }
})

test('without the Hibira MCP server the pane says how to connect it', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'hibira' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.list', () => ({ value: [] }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.command.run(RUN)
  expect(ran.text).toMatch(/Connect the Hibira MCP server/)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Connect Hibira/ })).toBeDefined()
    await ui.unmount()
  }
})
