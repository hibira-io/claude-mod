export type AppRow = {
  id: string
  name: string
  isEnabled: boolean
  connections: number
  messages: number
  url: string
}

export type Workspace = { id: string; name: string; pending: number }

export type Snapshot =
  | { isConnected: false; error?: string; updatedAt: number }
  | {
      isConnected: true
      plan: string
      connections: number
      connectionLimit: number
      messages: number
      messageLimit: number
      apps: AppRow[]
      workspaces: Workspace[]
      pending: number
      updatedAt: number
      error?: string
    }

declare module 'claude-code' {
  interface PluginState {
    'hibira-mod': { snapshot: Shaped<Snapshot | null> }
  }
}
