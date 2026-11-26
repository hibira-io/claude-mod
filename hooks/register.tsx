import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'
import {
  INBOX_URL,
  PORTAL_URL,
  SETUP_URL,
  compact,
  findServer,
  isHibiraTool,
  readJson,
  statusLine,
  toSnapshot,
} from './hibira'

const PANE = 'hibira'
const TITLE = 'Hibira'
const REFRESH_MS = 60_000

const snapshot = atom({ plugin: 'hibira-mod', key: 'snapshot' } as const, null, {
  shape: 'snapshot-1',
})

let server: string | undefined
let inFlight: Promise<void> | undefined

function refresh($: EngineInterface): Promise<void> {
  inFlight ??= refreshNow($).finally(() => {
    inFlight = undefined
  })

  return inFlight
}

async function refreshNow($: EngineInterface): Promise<void> {
  const previous = await read($, snapshot)
  const next = await load($)
  await update($, snapshot, () => next)
  $.ui.status(statusLine(next))
  const before = previous?.isConnected ? previous.pending : 0
  if (next.isConnected && next.pending > before) {
    const n = next.pending
    $.ui.toast(`Hibira: ${n} approval${n === 1 ? '' : 's'} waiting for you`)
  }
}

async function load($: EngineInterface): Promise<Snapshot> {
  const at = await $.clock.now()
  server = findServer(await $.tool.list())
  if (server === undefined) return { isConnected: false, updatedAt: at }
  const call = (tool: string, args?: Record<string, unknown>) =>
    $.mcp.call(server as string, tool, args).then(readJson)
  try {
    const [account, apps] = await Promise.all([call('get_account'), call('list_apps')])
    // A token without Approvals access, or an account in no workspace, just
    // shows no approvals.
    const workspaces = await call('api_get', { path: '/approvals/workspaces' }).catch(() => ({}))

    return toSnapshot({ account, apps, workspaces, at })
  } catch (error) {
    return {
      isConnected: false,
      error: error instanceof Error ? error.message : String(error),
      updatedAt: at,
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'hibira',
      description: 'Open the Hibira pane: live connections, messages today and approvals waiting',
    })
    $.clock.every(REFRESH_MS, () => {
      refresh($).catch(() => undefined)
    })
    refresh($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'hibira' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    const now = await read($, snapshot)

    return {
      text: now?.isConnected
        ? 'Hibira pane opened.'
        : `Hibira pane opened. Connect the Hibira MCP server to fill it: ${SETUP_URL}`,
    }
  })

  // After the agent publishes an event, asks for an approval or changes an
  // app through Hibira, show the new numbers right away.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (isHibiraTool(e.tool, server)) refresh($).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Progress } = $.ui.resolve(e)
    const s = await read($, snapshot)
    const refreshButton = (
      <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
    )

    if (s === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Loading your Hibira account…</Text>
        </Box>
      )
    }

    if (!s.isConnected) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text weight="semibold">Connect Hibira</Text>
          <Text dimColor>
            {s.error
              ? `The Hibira MCP server did not answer: ${s.error}`
              : 'This pane reads your account through the Hibira MCP server, which is not connected in this session.'}
          </Text>
          <Text>Install the Hibira plugin, then run /mcp and sign in to hibira.</Text>
          <Link href={SETUP_URL} label="How to install the Hibira plugin" />
          {refreshButton}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text weight="semibold">{s.plan ? `${s.plan} plan` : 'Your account'}</Text>
          <Progress
            label="Live connections"
            value={s.connections}
            max={s.connectionLimit || undefined}
            valueText={
              s.connectionLimit
                ? `${compact(s.connections)} / ${compact(s.connectionLimit)}`
                : compact(s.connections)
            }
          />
          <Progress
            label="Messages today"
            value={s.messages}
            max={s.messageLimit || undefined}
            valueText={
              s.messageLimit
                ? `${compact(s.messages)} / ${compact(s.messageLimit)}`
                : compact(s.messages)
            }
          />
        </Box>

        <Box flexDirection="column">
          <Text weight="semibold">Apps</Text>
          {s.apps.length === 0 && <Text dimColor>No apps yet.</Text>}
          {s.apps.map(app => (
            <Box key={app.id} flexDirection="column">
              <Text>
                {app.name}
                <Text dimColor>
                  {app.isEnabled ? '' : ' (off)'} · {compact(app.connections)} live ·{' '}
                  {compact(app.messages)} msgs today
                </Text>
              </Text>
              <Link href={app.url} label="Open in the portal" />
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text weight="semibold">Approvals</Text>
          {s.workspaces.length === 0 && <Text dimColor>No Approvals workspace.</Text>}
          {s.workspaces.map(ws => (
            <Text key={ws.id}>
              {ws.name}
              <Text dimColor>
                {' · '}
                {ws.pending === 0 ? 'nothing waiting' : `${ws.pending} waiting for you`}
              </Text>
            </Text>
          ))}
          {s.pending > 0 && <Link href={INBOX_URL} label="Answer in the Approvals inbox" />}
        </Box>

        <Box flexDirection="row" gap={1}>
          {refreshButton}
          <Link href={PORTAL_URL} label="Hibira portal" />
        </Box>
      </Box>
    )
  })
}
