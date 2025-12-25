/**
 * Terminal Connection Manager
 *
 * Factory module that routes terminal connections to the appropriate handler
 * based on connection type (local, SSH, Docker, reverse tunnel).
 */

import type { SessionLocation } from './types';

// ============================================================================
// Connection Interface
// ============================================================================

/**
 * Unified interface for terminal connections regardless of underlying transport.
 * Provides methods for writing data, resizing, and lifecycle management.
 */
export interface TerminalConnection {
  sessionId: string;
  write(data: Buffer): void;
  resize(cols: number, rows: number): void;
  close(): void;
  onData(callback: (data: Buffer) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
}

// ============================================================================
// Local Terminal Connection (Tmux via Bun subprocess)
// ============================================================================

/**
 * Local terminal connection using Bun's subprocess API to attach to tmux.
 */
class LocalTerminalConnection implements TerminalConnection {
  sessionId: string;
  private proc: any;
  private dataCallback?: (data: Buffer) => void;
  private closeCallback?: () => void;
  private errorCallback?: (error: Error) => void;
  private closed = false;

  constructor(
    sessionId: string,
    tmuxTarget: string,
    cols: number,
    rows: number
  ) {
    this.sessionId = sessionId;

    try {
      // Spawn tmux attach-session process
      // Use -d to detach other clients and -t to specify target
      this.proc = Bun.spawn(['tmux', 'attach-session', '-d', '-t', tmuxTarget], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLUMNS: cols.toString(),
          LINES: rows.toString(),
        },
      });

      // Set up output stream reader
      this.setupOutputReader();

      // Set up stderr reader for errors
      this.setupErrorReader();

      // Set up process exit handler
      this.setupExitHandler();

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.errorCallback) {
        this.errorCallback(err);
      }
      throw err;
    }
  }

  private async setupOutputReader() {
    try {
      const reader = this.proc.stdout.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (this.dataCallback && value) {
          this.dataCallback(Buffer.from(value));
        }
      }
    } catch (error) {
      if (!this.closed && this.errorCallback) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.errorCallback(err);
      }
    }
  }

  private async setupErrorReader() {
    try {
      const reader = this.proc.stderr.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && this.errorCallback) {
          const errorText = new TextDecoder().decode(value);
          this.errorCallback(new Error(`Tmux stderr: ${errorText}`));
        }
      }
    } catch (error) {
      // Suppress errors during cleanup
      if (!this.closed && this.errorCallback) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.errorCallback(err);
      }
    }
  }

  private setupExitHandler() {
    this.proc.exited.then((exitCode: number) => {
      if (!this.closed) {
        this.closed = true;
        if (this.closeCallback) {
          this.closeCallback();
        }
        if (exitCode !== 0 && this.errorCallback) {
          this.errorCallback(new Error(`Tmux process exited with code ${exitCode}`));
        }
      }
    });
  }

  write(data: Buffer): void {
    if (this.closed) {
      throw new Error('Cannot write to closed terminal connection');
    }
    try {
      this.proc.stdin.write(data);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.errorCallback) {
        this.errorCallback(err);
      }
    }
  }

  resize(cols: number, rows: number): void {
    // For tmux, we need to send escape sequences to resize
    // This is a simplified approach - proper implementation would use tmux control mode
    // or send SIGWINCH signal with stty
    try {
      const resizeCmd = `stty cols ${cols} rows ${rows}\n`;
      this.write(Buffer.from(resizeCmd));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.errorCallback) {
        this.errorCallback(err);
      }
    }
  }

  close(): void {
    if (this.closed) return;

    this.closed = true;

    try {
      // Close stdin to signal we're done
      this.proc.stdin.end();

      // Kill the process
      this.proc.kill();

      if (this.closeCallback) {
        this.closeCallback();
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.errorCallback) {
        this.errorCallback(err);
      }
    }
  }

  onData(callback: (data: Buffer) => void): void {
    this.dataCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }
}

// ============================================================================
// Connection Manager
// ============================================================================

/**
 * Central manager for creating and routing terminal connections.
 * Routes to appropriate handler based on connection type.
 */
export class ConnectionManager {
  /**
   * Create a terminal connection based on the session location configuration.
   *
   * @param location - Session location containing connection parameters
   * @param cols - Terminal width in columns
   * @param rows - Terminal height in rows
   * @returns Promise resolving to a TerminalConnection instance
   * @throws Error if connection type is not supported or connection fails
   */
  async connect(
    location: SessionLocation,
    cols: number,
    rows: number
  ): Promise<TerminalConnection> {
    switch (location.connection_type) {
      case 'local':
        return this.createLocalConnection(location, cols, rows);

      case 'ssh':
        return this.createSSHConnection(location, cols, rows);

      case 'docker':
        return this.createDockerConnection(location, cols, rows);

      case 'reverse':
        throw new Error(
          'Reverse tunnel connections are managed by agent-registry. ' +
          'Use AgentRegistry.connectToSession() instead.'
        );

      default:
        throw new Error(
          `Unknown connection type: ${(location as any).connection_type}`
        );
    }
  }

  /**
   * Create a local terminal connection using tmux.
   *
   * @param location - Session location with tmux parameters
   * @param cols - Terminal width
   * @param rows - Terminal height
   * @returns LocalTerminalConnection instance
   * @throws Error if tmux session name is not configured
   */
  private createLocalConnection(
    location: SessionLocation,
    cols: number,
    rows: number
  ): TerminalConnection {
    const tmuxTarget = location.tmux_session_name;

    if (!tmuxTarget) {
      throw new Error(
        'Local connection requires tmux_session_name in session location'
      );
    }

    // If tmux_window_name is specified, append it to the target
    const fullTarget = location.tmux_window_name
      ? `${tmuxTarget}:${location.tmux_window_name}`
      : tmuxTarget;

    return new LocalTerminalConnection(
      location.session_id,
      fullTarget,
      cols,
      rows
    );
  }

  /**
   * Create an SSH terminal connection.
   *
   * @param location - Session location with SSH parameters
   * @param cols - Terminal width
   * @param rows - Terminal height
   * @returns Promise resolving to TerminalConnection
   * @throws Error - Not yet implemented
   */
  private async createSSHConnection(
    location: SessionLocation,
    cols: number,
    rows: number
  ): Promise<TerminalConnection> {
    throw new Error(
      'SSH connections not yet implemented. ' +
      'Will use ssh2 library to connect to remote host and attach to tmux.'
    );
  }

  /**
   * Create a Docker container terminal connection.
   *
   * @param location - Session location with Docker parameters
   * @param cols - Terminal width
   * @param rows - Terminal height
   * @returns Promise resolving to TerminalConnection
   * @throws Error - Not yet implemented
   */
  private async createDockerConnection(
    location: SessionLocation,
    cols: number,
    rows: number
  ): Promise<TerminalConnection> {
    throw new Error(
      'Docker connections not yet implemented. ' +
      'Will use dockerode library to exec into container and attach to tmux.'
    );
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance of ConnectionManager for application-wide use.
 */
export const connectionManager = new ConnectionManager();
