import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export interface TmuxSession {
  sessionId: string;
  metadata: Record<string, string>;
}

export declare interface TmuxWatcher {
  on(event: 'session-start', listener: (session: TmuxSession) => void): this;
  on(event: 'session-end', listener: (sessionId: string) => void): this;
}

export class TmuxWatcher extends EventEmitter {
  private pollInterval: number;
  private timer: NodeJS.Timeout | null = null;
  private sessions: Map<string, TmuxSession> = new Map();

  constructor(pollInterval: number) {
    super();
    this.pollInterval = pollInterval;
  }

  async start(): Promise<void> {
    console.log('[TmuxWatcher] Starting watcher...');

    // Initial scan
    await this.scan();

    // Set up polling
    this.timer = setInterval(() => this.scan(), this.pollInterval);
  }

  stop(): void {
    console.log('[TmuxWatcher] Stopping watcher...');

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getSessions(): TmuxSession[] {
    return Array.from(this.sessions.values());
  }

  private async scan(): Promise<void> {
    try {
      const sessions = await this.listTmuxSessions();
      const currentSessionIds = new Set<string>();

      for (const session of sessions) {
        currentSessionIds.add(session.sessionId);

        if (!this.sessions.has(session.sessionId)) {
          // New session discovered
          this.sessions.set(session.sessionId, session);
          this.emit('session-start', session);
        }
      }

      // Check for ended sessions
      for (const [sessionId] of this.sessions) {
        if (!currentSessionIds.has(sessionId)) {
          this.sessions.delete(sessionId);
          this.emit('session-end', sessionId);
        }
      }
    } catch (error) {
      console.error('[TmuxWatcher] Scan failed:', error);
    }
  }

  private async listTmuxSessions(): Promise<TmuxSession[]> {
    return new Promise((resolve, reject) => {
      // List all tmux sessions with their environment
      const proc = spawn('tmux', ['list-sessions', '-F', '#{session_id}']);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', async (code) => {
        if (code !== 0) {
          if (stderr.includes('no server running')) {
            // No tmux server running - this is fine
            resolve([]);
            return;
          }
          reject(new Error(`tmux list-sessions failed: ${stderr}`));
          return;
        }

        const sessionIds = stdout.trim().split('\n').filter(Boolean);
        const sessions: TmuxSession[] = [];

        // Get environment for each session
        for (const sessionId of sessionIds) {
          try {
            const metadata = await this.getSessionEnvironment(sessionId);

            // Only include sessions with CCC_SESSION_* environment variables
            if (Object.keys(metadata).some(key => key.startsWith('CCC_SESSION_'))) {
              sessions.push({
                sessionId,
                metadata,
              });
            }
          } catch (error) {
            console.error(`[TmuxWatcher] Failed to get environment for session ${sessionId}:`, error);
          }
        }

        resolve(sessions);
      });
    });
  }

  private async getSessionEnvironment(sessionId: string): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tmux', ['show-environment', '-t', sessionId]);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`tmux show-environment failed: ${stderr}`));
          return;
        }

        const metadata: Record<string, string> = {};

        // Parse environment variables
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();

          // Skip empty lines and unset variables (starting with -)
          if (!trimmed || trimmed.startsWith('-')) {
            continue;
          }

          // Parse VAR=value format
          const match = trimmed.match(/^([^=]+)=(.*)$/);
          if (match) {
            const [, key, value] = match;

            // Only include CCC_SESSION_* variables
            if (key.startsWith('CCC_SESSION_')) {
              metadata[key] = value;
            }
          }
        }

        resolve(metadata);
      });
    });
  }
}
