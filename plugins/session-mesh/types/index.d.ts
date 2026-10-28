export type Presence = {
  id: string
  pid: string
  lstart: string
  sock?: string
  worktree: string
  project?: string
  level?: number
  role?: string
  n?: number
  ticket?: string
  wave?: string
  busy?: boolean
  tool?: string
  tok?: number
  win?: number
  pct?: number
  usd?: number
  at: number
}

export type View = { off: boolean; me: Presence | null; peers: Presence[] }

declare module 'claude-code' {
  interface PluginState {
    'session-mesh': { view: View }
  }
}
