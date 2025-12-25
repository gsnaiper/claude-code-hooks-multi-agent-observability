/**
 * Agent Handler
 *
 * WebSocket protocol handler for remote agents (ccc-agent).
 * Manages communication between the gateway and remote terminal agents,
 * including registration, heartbeats, session management, and terminal I/O.
 */

import type { WebSocket } from 'ws';
import type {
  AgentToGatewayMessage,
  GatewayToAgentMessage,
  AgentRegisterMessage,
  AgentHeartbeatMessage,
  AgentSessionStartMessage,
  AgentSessionEndMessage,
  AgentOutputMessage,
  AgentErrorMessage,
  AgentConnectCommand,
  AgentInputCommand,
  AgentResizeCommand,
  AgentDisconnectCommand,
  AgentPingCommand,
  AgentRegisteredMessage,
  AgentPongMessage,
  GatewayErrorMessage,
  TerminalOutputMessage,
} from './types';
import { agentRegistry } from './agent-registry';
import {
  getSessionLocation,
  createSessionLocation,
  updateSessionLocation,
} from './location-registry';

// ============================================================================
// Agent Handler Class
// ============================================================================

/**
 * Handles WebSocket protocol for remote agent connections
 */
class AgentHandler {
  private agentToWebSocket: Map<string, WebSocket>;
  private webSocketToAgent: Map<WebSocket, string>;

  constructor() {
    this.agentToWebSocket = new Map();
    this.webSocketToAgent = new Map();
  }

  /**
   * Validate agent credentials against configured secrets
   * Supports:
   * - AGENT_SECRETS: comma-separated list of valid secrets (any agent can use)
   * - AGENT_SECRET_<AGENT_ID>: per-agent secret (normalized: - and . become _)
   * - No secrets configured: allow all (development mode with warning)
   */
  private validateAgentCredentials(
    agentId: string,
    agentSecret?: string
  ): boolean {
    // Check per-agent secret first (AGENT_SECRET_my_agent_id)
    const normalizedAgentId = agentId.replace(/[-\.]/g, '_').toUpperCase();
    const perAgentSecret = process.env[`AGENT_SECRET_${normalizedAgentId}`];

    if (perAgentSecret) {
      return agentSecret === perAgentSecret;
    }

    // Check global secrets list
    const globalSecrets = process.env.AGENT_SECRETS;
    if (globalSecrets) {
      const validSecrets = globalSecrets.split(',').map((s) => s.trim());
      return agentSecret !== undefined && validSecrets.includes(agentSecret);
    }

    // No secrets configured - development mode
    // Allow all but log warning
    console.warn(
      `[AgentHandler] No AGENT_SECRETS or AGENT_SECRET_${normalizedAgentId} configured. ` +
        'Allowing all agents in development mode.'
    );
    return true;
  }

  // ==========================================================================
  // Message Handling (Incoming from Agent)
  // ==========================================================================

  /**
   * Handle incoming message from an agent
   */
  async handleMessage(
    agentId: string,
    ws: WebSocket,
    message: AgentToGatewayMessage
  ): Promise<void> {
    try {
      switch (message.type) {
        case 'agent:register':
          await this.handleRegister(ws, message);
          break;

        case 'agent:heartbeat':
          this.handleHeartbeat(agentId, message);
          break;

        case 'agent:session:start':
          await this.handleSessionStart(agentId, message);
          break;

        case 'agent:session:end':
          await this.handleSessionEnd(agentId, message);
          break;

        case 'agent:session:output':
          this.handleOutput(agentId, message);
          break;

        case 'agent:session:error':
          this.handleError(agentId, message);
          break;

        case 'agent:ack':
          // Acknowledgment received - could add logging/metrics here
          console.log(
            `[AgentHandler] Agent ${agentId} acknowledged ${message.command_type} for session ${message.session_id || 'N/A'}: ${message.success ? 'success' : 'failed'}`
          );
          if (message.message) {
            console.log(`[AgentHandler] Message: ${message.message}`);
          }
          break;

        default:
          console.warn(
            `[AgentHandler] Unknown message type from agent ${agentId}:`,
            (message as any).type
          );
      }
    } catch (error) {
      console.error(
        `[AgentHandler] Error handling message from agent ${agentId}:`,
        error
      );
    }
  }

  // ==========================================================================
  // Individual Message Handlers
  // ==========================================================================

  /**
   * Handle agent registration
   */
  private async handleRegister(
    ws: WebSocket,
    message: AgentRegisterMessage
  ): Promise<void> {
    const { agent_id, agent_secret, hostname, platform, version } = message;

    console.log(
      `[AgentHandler] Agent registration request: ${agent_id} from ${hostname || 'unknown'}`
    );

    // Validate agent credentials
    // Uses AGENT_SECRETS env var (comma-separated list of valid secrets)
    // or AGENT_SECRET_<AGENT_ID> for per-agent secrets
    // If no secrets configured, allow all (development mode)
    const isValid = this.validateAgentCredentials(agent_id, agent_secret);

    if (!isValid) {
      console.warn(
        `[AgentHandler] Agent ${agent_id} failed authentication`
      );
      const errorMsg: GatewayErrorMessage = {
        type: 'gateway:error',
        error: 'Invalid agent credentials',
        timestamp: Date.now(),
      };
      this.sendMessage(ws, errorMsg);
      ws.close(1008, 'Invalid credentials');
      return;
    }

    // Register in registry
    agentRegistry.registerAgent(agent_id, ws);

    // Track agent WebSocket
    this.agentToWebSocket.set(agent_id, ws);
    this.webSocketToAgent.set(ws, agent_id);

    // Send confirmation
    const response: AgentRegisteredMessage = {
      type: 'agent:registered',
      agent_id,
      message: 'Agent successfully registered with gateway',
      timestamp: Date.now(),
    };
    this.sendMessage(ws, response);

    console.log(
      `[AgentHandler] Agent registered: ${agent_id} (${platform || 'unknown'} v${version || 'unknown'})`
    );
  }

  /**
   * Handle heartbeat from agent
   */
  private handleHeartbeat(
    agentId: string,
    message: AgentHeartbeatMessage
  ): void {
    agentRegistry.updateHeartbeat(agentId);

    // Send pong response
    const response: AgentPongMessage = {
      type: 'agent:pong',
      timestamp: Date.now(),
    };

    const ws = this.agentToWebSocket.get(agentId);
    if (ws) {
      this.sendMessage(ws, response);
    }

    // Optional: Log system info
    if (message.system_info) {
      console.log(
        `[AgentHandler] Agent ${agentId} heartbeat:`,
        message.system_info
      );
    }
  }

  /**
   * Handle session start notification from agent
   */
  private async handleSessionStart(
    agentId: string,
    message: AgentSessionStartMessage
  ): Promise<void> {
    const { session_id, project_id, tmux_session_name, tmux_window_name } =
      message;

    const tmuxTarget =
      tmux_session_name && tmux_window_name
        ? `${tmux_session_name}:${tmux_window_name}`
        : tmux_session_name || session_id;

    agentRegistry.registerSession(agentId, session_id, tmuxTarget, project_id);

    console.log(
      `[AgentHandler] Session started on agent ${agentId}: ${session_id} (tmux: ${tmuxTarget})`
    );

    // Update database with session location information
    try {
      const existingLocation = await getSessionLocation(session_id);
      if (existingLocation) {
        // Update existing location
        await updateSessionLocation(session_id, {
          connection_type: 'reverse',
          reverse_agent_id: agentId,
          tmux_session_name: tmux_session_name || session_id,
          tmux_window_name,
          status: 'active',
          last_verified_at: new Date(),
        });
      } else {
        // Create new location entry
        await createSessionLocation({
          session_id,
          project_id: project_id || 'unknown',
          connection_type: 'reverse',
          reverse_agent_id: agentId,
          tmux_session_name: tmux_session_name || session_id,
          tmux_window_name,
          status: 'active',
        });
      }
    } catch (error) {
      console.error(
        `[AgentHandler] Error updating session location for ${session_id}:`,
        error
      );
    }
  }

  /**
   * Handle session end notification from agent
   */
  private async handleSessionEnd(
    agentId: string,
    message: AgentSessionEndMessage
  ): Promise<void> {
    const { session_id, reason } = message;

    agentRegistry.unregisterSession(agentId, session_id);

    console.log(
      `[AgentHandler] Session ended on agent ${agentId}: ${session_id}${reason ? ` (${reason})` : ''}`
    );

    // Update database session status
    try {
      await updateSessionLocation(session_id, {
        status: 'inactive',
        last_verified_at: new Date(),
      });
    } catch (error) {
      console.error(
        `[AgentHandler] Error updating session status for ${session_id}:`,
        error
      );
    }
  }

  /**
   * Handle terminal output from agent
   */
  private handleOutput(agentId: string, message: AgentOutputMessage): void {
    const { session_id, data } = message;

    // Get session info to find attached clients
    const sessionInfo = agentRegistry.getSessionInfo(session_id);
    if (!sessionInfo) {
      console.warn(
        `[AgentHandler] Received output for unknown session: ${session_id}`
      );
      return;
    }

    // Forward output to all attached web clients
    const outputMsg: TerminalOutputMessage = {
      type: 'terminal:output',
      session_id,
      data,
      timestamp: Date.now(),
    };

    const msgStr = JSON.stringify(outputMsg);
    for (const clientWs of sessionInfo.attachedClients) {
      try {
        if (clientWs.readyState === 1) {
          // WebSocket.OPEN
          clientWs.send(msgStr);
        }
      } catch (error) {
        console.error(
          `[AgentHandler] Error forwarding output to client:`,
          error
        );
      }
    }
  }

  /**
   * Handle error message from agent
   */
  private handleError(agentId: string, message: AgentErrorMessage): void {
    const { session_id, error, details } = message;

    console.error(
      `[AgentHandler] Agent ${agentId} error${session_id ? ` (session: ${session_id})` : ''}: ${error}`,
      details
    );

    // If session-specific error, forward to attached clients
    if (session_id) {
      const sessionInfo = agentRegistry.getSessionInfo(session_id);
      if (sessionInfo) {
        const errorMsg = {
          type: 'terminal:error',
          session_id,
          error,
          details,
          timestamp: Date.now(),
        };

        const msgStr = JSON.stringify(errorMsg);
        for (const clientWs of sessionInfo.attachedClients) {
          try {
            if (clientWs.readyState === 1) {
              clientWs.send(msgStr);
            }
          } catch (err) {
            console.error(
              `[AgentHandler] Error forwarding error to client:`,
              err
            );
          }
        }
      }
    }
  }

  // ==========================================================================
  // Commands to Send to Agent
  // ==========================================================================

  /**
   * Request agent to attach to a terminal session
   */
  sendConnect(
    agentId: string,
    sessionId: string,
    cols?: number,
    rows?: number
  ): boolean {
    const ws = this.agentToWebSocket.get(agentId);
    if (!ws) {
      console.error(
        `[AgentHandler] Cannot send connect: Agent ${agentId} not found`
      );
      return false;
    }

    const command: AgentConnectCommand = {
      type: 'agent:command:connect',
      session_id: sessionId,
      cols,
      rows,
      timestamp: Date.now(),
    };

    this.sendMessage(ws, command);
    console.log(
      `[AgentHandler] Sent connect command to agent ${agentId} for session ${sessionId}`
    );
    return true;
  }

  /**
   * Send terminal input to agent
   */
  sendInput(agentId: string, sessionId: string, data: string): boolean {
    const ws = this.agentToWebSocket.get(agentId);
    if (!ws) {
      console.error(
        `[AgentHandler] Cannot send input: Agent ${agentId} not found`
      );
      return false;
    }

    const command: AgentInputCommand = {
      type: 'agent:command:input',
      session_id: sessionId,
      data,
      timestamp: Date.now(),
    };

    this.sendMessage(ws, command);
    return true;
  }

  /**
   * Send terminal resize command to agent
   */
  sendResize(
    agentId: string,
    sessionId: string,
    cols: number,
    rows: number
  ): boolean {
    const ws = this.agentToWebSocket.get(agentId);
    if (!ws) {
      console.error(
        `[AgentHandler] Cannot send resize: Agent ${agentId} not found`
      );
      return false;
    }

    const command: AgentResizeCommand = {
      type: 'agent:command:resize',
      session_id: sessionId,
      cols,
      rows,
      timestamp: Date.now(),
    };

    this.sendMessage(ws, command);
    console.log(
      `[AgentHandler] Sent resize command to agent ${agentId} for session ${sessionId}: ${cols}x${rows}`
    );
    return true;
  }

  /**
   * Request agent to disconnect from terminal session
   */
  sendDisconnect(agentId: string, sessionId: string): boolean {
    const ws = this.agentToWebSocket.get(agentId);
    if (!ws) {
      console.error(
        `[AgentHandler] Cannot send disconnect: Agent ${agentId} not found`
      );
      return false;
    }

    const command: AgentDisconnectCommand = {
      type: 'agent:command:disconnect',
      session_id: sessionId,
      timestamp: Date.now(),
    };

    this.sendMessage(ws, command);
    console.log(
      `[AgentHandler] Sent disconnect command to agent ${agentId} for session ${sessionId}`
    );
    return true;
  }

  /**
   * Send ping to agent (heartbeat check)
   */
  sendPing(agentId: string): boolean {
    const ws = this.agentToWebSocket.get(agentId);
    if (!ws) {
      console.error(
        `[AgentHandler] Cannot send ping: Agent ${agentId} not found`
      );
      return false;
    }

    const command: AgentPingCommand = {
      type: 'agent:command:ping',
      timestamp: Date.now(),
    };

    this.sendMessage(ws, command);
    return true;
  }

  // ==========================================================================
  // WebSocket Utilities
  // ==========================================================================

  /**
   * Send a message to an agent WebSocket
   */
  private sendMessage(ws: WebSocket, message: GatewayToAgentMessage): void {
    try {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        ws.send(JSON.stringify(message));
      } else {
        console.warn(
          `[AgentHandler] Cannot send message: WebSocket not open (state: ${ws.readyState})`
        );
      }
    } catch (error) {
      console.error(`[AgentHandler] Error sending message to agent:`, error);
    }
  }

  /**
   * Handle agent WebSocket disconnection
   */
  handleDisconnect(ws: WebSocket): void {
    const agentId = this.webSocketToAgent.get(ws);
    if (!agentId) {
      return;
    }

    console.log(`[AgentHandler] Agent disconnected: ${agentId}`);

    // Unregister from registry (this will clean up all sessions)
    agentRegistry.unregisterAgent(agentId);

    // Clean up tracking maps
    this.agentToWebSocket.delete(agentId);
    this.webSocketToAgent.delete(ws);
  }

  /**
   * Get agent ID from WebSocket
   */
  getAgentId(ws: WebSocket): string | undefined {
    return this.webSocketToAgent.get(ws);
  }

  /**
   * Check if agent is connected
   */
  isAgentConnected(agentId: string): boolean {
    const ws = this.agentToWebSocket.get(agentId);
    return ws !== undefined && ws.readyState === 1; // WebSocket.OPEN
  }

  /**
   * Get all connected agent IDs
   */
  getConnectedAgentIds(): string[] {
    return Array.from(this.agentToWebSocket.keys());
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global singleton instance of the agent handler
 */
export const agentHandler = new AgentHandler();

// ============================================================================
// Connection Handler
// ============================================================================

/**
 * Handle new agent WebSocket connection
 * This should be called when a new WebSocket connects to the agent endpoint
 */
export function handleAgentConnection(ws: WebSocket): void {
  console.log('[AgentHandler] New agent connection established');

  // Set up message handler
  ws.on('message', async (data: Buffer | string) => {
    try {
      const messageStr = data.toString();
      const message: AgentToGatewayMessage = JSON.parse(messageStr);

      // For registration, we don't have agentId yet
      if (message.type === 'agent:register') {
        await agentHandler.handleMessage(
          (message as AgentRegisterMessage).agent_id,
          ws,
          message
        );
        return;
      }

      // For other messages, get agentId from WebSocket
      const agentId = agentHandler.getAgentId(ws);
      if (!agentId) {
        console.warn(
          '[AgentHandler] Received message from unregistered agent'
        );
        ws.close(1008, 'Agent not registered');
        return;
      }

      await agentHandler.handleMessage(agentId, ws, message);
    } catch (error) {
      console.error('[AgentHandler] Error handling agent message:', error);
    }
  });

  // Set up disconnect handler
  ws.on('close', () => {
    agentHandler.handleDisconnect(ws);
  });

  // Set up error handler
  ws.on('error', (error: Error) => {
    console.error('[AgentHandler] WebSocket error:', error);
  });
}
