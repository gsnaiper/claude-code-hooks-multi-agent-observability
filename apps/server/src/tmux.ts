/**
 * tmux Query Service
 *
 * Queries running tmux sessions to find Claude Code sessions by session_id.
 * Uses CCC_SESSION_* environment variables stored in tmux to map session_id → tmux target.
 */

import { $ } from 'bun'

export interface TmuxWindowInfo {
  sessionName: string      // e.g., "ccc-DJ"
  windowName: string       // e.g., "myproject-session-a"
  windowIndex: number      // e.g., 0
  target: string           // e.g., "ccc-DJ:myproject-session-a"
  isAttached: boolean      // Is someone currently attached?
  paneCommand?: string     // Current command running in pane
  sessionId?: string       // Extracted from CCC_SESSION_* env var
}

export interface TmuxQueryResult {
  found: boolean
  info?: TmuxWindowInfo
  error?: string
}

/**
 * Execute a shell command safely using Bun's shell API
 */
async function execCommand(cmd: string): Promise<string> {
  try {
    const result = await $`sh -c ${cmd}`.quiet().text()
    return result.trim()
  } catch (error: any) {
    // Handle common tmux errors gracefully
    const stderr = error.stderr?.toString() || ''
    if (stderr.includes('no server running') ||
        stderr.includes('No such file or directory') ||
        error.exitCode === 1) {
      return ''
    }
    throw error
  }
}

/**
 * Get all CCC session mappings from tmux environment variables
 * Returns a Map of session_id → TmuxWindowInfo
 */
export async function getTmuxSessionMapping(): Promise<Map<string, TmuxWindowInfo>> {
  const mapping = new Map<string, TmuxWindowInfo>()

  try {
    // Step 1: List all tmux sessions with their attached status
    const sessionsOutput = await execCommand(
      'tmux list-sessions -F "#{session_name}|#{session_attached}" 2>/dev/null'
    )

    if (!sessionsOutput) {
      return mapping // No tmux server running
    }

    const sessions = sessionsOutput.split('\n').filter(Boolean)

    // Step 2: For each CCC session, get environment variables and windows
    for (const sessionLine of sessions) {
      const [sessionName, attachedStr] = sessionLine.split('|')

      // Only process ccc-* sessions
      if (!sessionName.startsWith('ccc-')) {
        continue
      }

      const isAttached = attachedStr === '1'

      // Get environment variables for this session
      const envOutput = await execCommand(
        `tmux show-environment -t "${sessionName}" 2>/dev/null`
      )

      if (!envOutput) continue

      // Parse CCC_SESSION_* variables
      for (const line of envOutput.split('\n')) {
        const match = line.match(/^CCC_SESSION_(.+)=(.+)$/)
        if (!match) continue

        const [, windowName, sessionId] = match

        // Get window details
        const windowsOutput = await execCommand(
          `tmux list-windows -t "${sessionName}" -F "#{window_index}|#{window_name}|#{pane_current_command}" 2>/dev/null`
        )

        let windowIndex = 0
        let paneCommand = ''

        // Find the matching window
        for (const windowLine of windowsOutput.split('\n').filter(Boolean)) {
          const [idx, name, cmd] = windowLine.split('|')
          if (name === windowName) {
            windowIndex = parseInt(idx, 10)
            paneCommand = cmd
            break
          }
        }

        const info: TmuxWindowInfo = {
          sessionName,
          windowName,
          windowIndex,
          target: `${sessionName}:${windowName}`,
          isAttached,
          paneCommand,
          sessionId
        }

        mapping.set(sessionId, info)
      }
    }
  } catch (error) {
    console.error('[tmux] Error getting session mapping:', error)
  }

  return mapping
}

/**
 * Find tmux window for a specific session_id
 */
export async function findTmuxWindow(sessionId: string): Promise<TmuxQueryResult> {
  try {
    const mapping = await getTmuxSessionMapping()
    const info = mapping.get(sessionId)

    if (info) {
      return { found: true, info }
    }

    // Try partial match (first 8 chars)
    const shortId = sessionId.slice(0, 8)
    for (const [id, windowInfo] of mapping.entries()) {
      if (id.startsWith(shortId)) {
        return { found: true, info: windowInfo }
      }
    }

    return { found: false }
  } catch (error) {
    return {
      found: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get list of all active CCC tmux sessions
 */
export async function getActiveCCCSessions(): Promise<string[]> {
  try {
    const output = await execCommand(
      'tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^ccc-"'
    )
    return output.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Build ttyd URL for a tmux target
 */
export function buildTtydUrl(target: string, ttydBase?: string): string {
  const base = ttydBase || process.env.TTYD_URL || 'https://ttyd.di4.dev'
  // URL format for ttyd with --url-arg: ?arg=<target>
  return `${base}/?arg=${encodeURIComponent(target)}`
}
