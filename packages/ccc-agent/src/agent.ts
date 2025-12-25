import WebSocket from 'ws';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { TmuxWatcher, TmuxSession } from './tmux-watcher.js';

export interface AgentConfig {
  gatewayUrl: string;
  agentId: string;
  agentSecret: string;
  pollInterval: number;
}

interface SessionConnection {
  sessionId: string;
  process: ChildProcessWithoutNullStreams;
  buffer: Buffer[];
}

export class Agent {
  private config: AgentConfig;
  private ws: WebSocket | null = null;
  private watcher: TmuxWatcher;
  private sessions: Map<string, SessionConnection> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.watcher = new TmuxWatcher(config.pollInterval);

    // Listen for tmux session events
    this.watcher.on('session-start', (session: TmuxSession) => {
      console.log(`[Agent] Discovered session: ${session.sessionId}`);
      this.registerSession(session);
    });

    this.watcher.on('session-end', (sessionId: string) => {
      console.log(`[Agent] Session ended: ${sessionId}`);
      this.unregisterSession(sessionId);
    });
  }

  async start(): Promise<void> {
    console.log(`[Agent] Starting agent ${this.config.agentId}`);
    this.running = true;

    // Start watching tmux sessions
    await this.watcher.start();

    // Connect to gateway
    this.connect();
  }

  stop(): void {
    console.log('[Agent] Stopping agent...');
    this.running = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close all session connections
    for (const [sessionId, conn] of this.sessions) {
      this.disconnectSession(sessionId);
    }

    // Stop tmux watcher
    this.watcher.stop();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    process.exit(0);
  }

  private connect(): void {
    console.log(`[Agent] Connecting to gateway: ${this.config.gatewayUrl}`);

    this.ws = new WebSocket(this.config.gatewayUrl, {
      headers: {
        'x-agent-id': this.config.agentId,
        'x-agent-secret': this.config.agentSecret,
      },
    });

    this.ws.on('open', () => {
      console.log('[Agent] Connected to gateway');

      // Register agent with gateway
      const activeSessions = this.watcher.getSessions();
      this.send({
        type: 'agent:register',
        agent_id: this.config.agentId,
        agent_secret: this.config.agentSecret,
        sessions: activeSessions.map(s => ({
          session_id: s.sessionId,
          tmux_session_name: s.sessionId,
          metadata: s.metadata,
        })),
      });
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('[Agent] Failed to parse message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('[Agent] Disconnected from gateway');
      this.ws = null;

      if (this.running) {
        // Attempt reconnect after 5 seconds
        console.log('[Agent] Reconnecting in 5 seconds...');
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });

    this.ws.on('error', (error) => {
      console.error('[Agent] WebSocket error:', error);
    });
  }

  private handleMessage(message: any): void {
    const { type } = message;
    // Gateway uses session_id (snake_case) in protocol
    const sessionId = message.session_id || message.sessionId;

    switch (type) {
      case 'agent:command:connect':
        this.connectSession(sessionId, message.rows, message.cols);
        break;

      case 'agent:command:input':
        this.sendInput(sessionId, message.data);
        break;

      case 'agent:command:resize':
        this.resizeSession(sessionId, message.rows, message.cols);
        break;

      case 'agent:command:disconnect':
        this.disconnectSession(sessionId);
        break;

      case 'agent:command:ping':
        this.send({ type: 'agent:heartbeat', agent_id: this.config.agentId });
        break;

      case 'agent:registered':
        console.log(`[Agent] Registration confirmed: ${message.message || 'OK'}`);
        break;

      case 'agent:pong':
        // Heartbeat response received
        break;

      case 'gateway:error':
        console.error(`[Agent] Gateway error: ${message.error}`, message.details);
        break;

      default:
        console.warn(`[Agent] Unknown message type: ${type}`);
    }
  }

  private registerSession(session: TmuxSession): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log(`[Agent] Not connected, deferring session registration: ${session.sessionId}`);
      return;
    }

    this.send({
      type: 'agent:session:start',
      session_id: session.sessionId,
      tmux_session_name: session.sessionId,
      metadata: session.metadata,
    });
  }

  private unregisterSession(sessionId: string): void {
    // Close any active connection
    this.disconnectSession(sessionId);

    // Notify gateway
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'agent:session:end',
        session_id: sessionId,
      });
    }
  }

  private connectSession(sessionId: string, rows: number, cols: number): void {
    if (this.sessions.has(sessionId)) {
      console.log(`[Agent] Session already connected: ${sessionId}`);
      return;
    }

    console.log(`[Agent] Connecting to session: ${sessionId} (${cols}x${rows})`);

    // Spawn tmux attach process
    const proc = spawn('tmux', ['attach-session', '-t', sessionId, '-r'], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });

    const conn: SessionConnection = {
      sessionId,
      process: proc,
      buffer: [],
    };

    this.sessions.set(sessionId, conn);

    // Forward stdout to gateway
    proc.stdout.on('data', (data: Buffer) => {
      this.send({
        type: 'agent:session:output',
        session_id: sessionId,
        data: data.toString('base64'),
      });
    });

    // Forward stderr to gateway (if needed)
    proc.stderr.on('data', (data: Buffer) => {
      console.error(`[Agent] Session ${sessionId} stderr:`, data.toString());
      // Send errors to gateway as well
      this.send({
        type: 'agent:session:error',
        session_id: sessionId,
        error: data.toString(),
      });
    });

    // Handle process exit
    proc.on('exit', (code) => {
      console.log(`[Agent] Session process exited: ${sessionId} (code: ${code})`);
      this.sessions.delete(sessionId);

      this.send({
        type: 'agent:session:end',
        session_id: sessionId,
        reason: `Process exited with code ${code}`,
      });
    });

    // Resize terminal
    this.resizeSession(sessionId, rows, cols);
  }

  private disconnectSession(sessionId: string): void {
    const conn = this.sessions.get(sessionId);
    if (!conn) {
      return;
    }

    console.log(`[Agent] Disconnecting session: ${sessionId}`);

    // Kill the tmux attach process
    conn.process.kill('SIGTERM');
    this.sessions.delete(sessionId);
  }

  private sendInput(sessionId: string, data: string): void {
    const conn = this.sessions.get(sessionId);
    if (!conn) {
      console.warn(`[Agent] Session not connected: ${sessionId}`);
      return;
    }

    // Decode base64 and write to stdin
    const buffer = Buffer.from(data, 'base64');
    conn.process.stdin.write(buffer);
  }

  private resizeSession(sessionId: string, rows: number, cols: number): void {
    // Use tmux resize-pane command
    spawn('tmux', ['resize-pane', '-t', sessionId, '-x', String(cols), '-y', String(rows)]);
  }

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
