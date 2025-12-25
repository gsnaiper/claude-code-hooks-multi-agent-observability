/**
 * Terminal Gateway
 *
 * Main WebSocket router/coordinator for the distributed terminal gateway.
 * Handles both:
 * 1. Web client connections (for terminal viewing) at `/terminal`
 * 2. Agent connections (for reverse tunnels) at `/agent`
 *
 * Routes terminal connections to the appropriate handler (local/SSH/Docker/reverse tunnel)
 * based on session location configuration stored in the database.
 */

import type { WebSocket } from 'ws';
import type {
  TerminalClientMessage,
  TerminalConnectMessage,
  TerminalInputMessage,
  TerminalResizeMessage,
  TerminalDisconnectMessage,
  TerminalOutputMessage,
  TerminalStatusMessage,
  TerminalErrorMessage,
  SessionLocation,
} from './types';
import type { TerminalConnection } from './connection-manager';
import { connectionManager } from './connection-manager';
import { agentRegistry } from './agent-registry';
import { agentHandler, handleAgentConnection } from './agent-handler';
import {
  getSessionLocation,
  updateSessionLocation,
} from './location-registry';

// ============================================================================
// Types
// ============================================================================

/**
 * Active terminal session managed by the gateway
 */
interface ActiveSession {
  sessionId: string;
  projectId: string;
  clientWs: WebSocket;
  connection?: TerminalConnection; // For local/SSH/Docker
  connectionType: 'local' | 'ssh' | 'docker' | 'reverse';
  agentId?: string; // For reverse tunnel connections
  createdAt: Date;
  lastActivity: Date;
}

// ============================================================================
// Terminal Gateway Class
// ============================================================================

/**
 * Central coordinator for terminal WebSocket connections.
 * Routes connections and manages terminal I/O for both direct and agent-based sessions.
 */
export class TerminalGateway {
  private activeSessions: Map<string, ActiveSession>;
  private clientToSession: Map<WebSocket, string>;

  constructor() {
    this.activeSessions = new Map();
    this.clientToSession = new Map();
  }

  // ==========================================================================
  // Web Client Message Handling
  // ==========================================================================

  /**
   * Handle WebSocket connection from a web client
   */
  handleClientConnection(ws: WebSocket): void {
    console.log('[TerminalGateway] New web client connection');

    // Set up message handler
    ws.on('message', async (data: Buffer | string) => {
      try {
        const messageStr = data.toString();
        const message: TerminalClientMessage = JSON.parse(messageStr);

        await this.handleClientMessage(ws, message);
      } catch (error) {
        console.error('[TerminalGateway] Error handling client message:', error);
        this.sendError(ws, 'unknown', 'Failed to process message', error);
      }
    });

    // Set up disconnect handler
    ws.on('close', () => {
      this.handleClientDisconnect(ws);
    });

    // Set up error handler
    ws.on('error', (error: Error) => {
      console.error('[TerminalGateway] Client WebSocket error:', error);
    });
  }

  /**
   * Route client message to appropriate handler
   */
  private async handleClientMessage(
    ws: WebSocket,
    message: TerminalClientMessage
  ): Promise<void> {
    switch (message.type) {
      case 'terminal:connect':
        await this.handleConnect(ws, message);
        break;

      case 'terminal:input':
        this.handleInput(ws, message);
        break;

      case 'terminal:resize':
        this.handleResize(ws, message);
        break;

      case 'terminal:disconnect':
        this.handleDisconnect(ws, message);
        break;

      default:
        console.warn(
          '[TerminalGateway] Unknown message type:',
          (message as any).type
        );
    }
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  /**
   * Handle terminal connection request from web client
   */
  private async handleConnect(
    ws: WebSocket,
    message: TerminalConnectMessage
  ): Promise<void> {
    const { session_id, project_id, cols = 80, rows = 24 } = message;

    console.log(
      `[TerminalGateway] Connect request: session=${session_id}, project=${project_id}`
    );

    try {
      // 1. Look up session location in database
      const location = await getSessionLocation(session_id);

      if (!location) {
        this.sendError(
          ws,
          session_id,
          'Session location not found. The session may not have been registered yet.',
          { session_id, project_id }
        );
        return;
      }

      // 2. Route based on connection type
      if (location.connection_type === 'reverse') {
        await this.connectViaAgent(ws, location, session_id, project_id, cols, rows);
      } else {
        await this.connectDirect(ws, location, session_id, project_id, cols, rows);
      }

      // 3. Update session location status
      await updateSessionLocation(session_id, {
        status: 'active',
        last_verified_at: new Date(),
      });

    } catch (error) {
      console.error(
        `[TerminalGateway] Error connecting to session ${session_id}:`,
        error
      );
      this.sendError(
        ws,
        session_id,
        'Failed to connect to terminal session',
        error
      );
    }
  }

  /**
   * Connect to terminal via remote agent (reverse tunnel)
   */
  private async connectViaAgent(
    ws: WebSocket,
    location: SessionLocation,
    sessionId: string,
    projectId: string,
    cols: number,
    rows: number
  ): Promise<void> {
    const agentId = location.reverse_agent_id;

    if (!agentId) {
      throw new Error('Reverse connection type requires agent_id');
    }

    // Check if agent is online
    if (!agentRegistry.isAgentOnline(agentId)) {
      throw new Error(`Agent ${agentId} is not currently online`);
    }

    // Register client with agent registry
    const attached = agentRegistry.attachClientToSession(sessionId, ws);
    if (!attached) {
      throw new Error(
        `Failed to attach to session ${sessionId} on agent ${agentId}`
      );
    }

    // Track active session
    const activeSession: ActiveSession = {
      sessionId,
      projectId,
      clientWs: ws,
      connectionType: 'reverse',
      agentId,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.activeSessions.set(sessionId, activeSession);
    this.clientToSession.set(ws, sessionId);

    // Send connect command to agent
    const success = agentHandler.sendConnect(agentId, sessionId, cols, rows);
    if (!success) {
      throw new Error(`Failed to send connect command to agent ${agentId}`);
    }

    // Send status to client
    this.sendStatus(ws, sessionId, 'connected', {
      connection_type: 'reverse',
      agent_id: agentId,
    });

    console.log(
      `[TerminalGateway] Connected to session ${sessionId} via agent ${agentId}`
    );
  }

  /**
   * Connect to terminal directly (local/SSH/Docker)
   */
  private async connectDirect(
    ws: WebSocket,
    location: SessionLocation,
    sessionId: string,
    projectId: string,
    cols: number,
    rows: number
  ): Promise<void> {
    // Create terminal connection
    const connection = await connectionManager.connect(location, cols, rows);

    // Track active session
    const activeSession: ActiveSession = {
      sessionId,
      projectId,
      clientWs: ws,
      connection,
      connectionType: location.connection_type as 'local' | 'ssh' | 'docker',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.activeSessions.set(sessionId, activeSession);
    this.clientToSession.set(ws, sessionId);

    // Set up connection event handlers
    connection.onData((data: Buffer) => {
      this.handleConnectionData(sessionId, data);
    });

    connection.onClose(() => {
      this.handleConnectionClose(sessionId);
    });

    connection.onError((error: Error) => {
      this.handleConnectionError(sessionId, error);
    });

    // Send status to client
    this.sendStatus(ws, sessionId, 'connected', {
      connection_type: location.connection_type,
    });

    console.log(
      `[TerminalGateway] Connected to session ${sessionId} via ${location.connection_type}`
    );
  }

  // ==========================================================================
  // Input/Output Handling
  // ==========================================================================

  /**
   * Handle input from web client
   */
  private handleInput(ws: WebSocket, message: TerminalInputMessage): void {
    const { session_id, data } = message;
    const session = this.activeSessions.get(session_id);

    if (!session) {
      console.warn(
        `[TerminalGateway] Input for unknown session: ${session_id}`
      );
      return;
    }

    session.lastActivity = new Date();

    try {
      if (session.connectionType === 'reverse' && session.agentId) {
        // Forward to agent
        agentHandler.sendInput(session.agentId, session_id, data);
      } else if (session.connection) {
        // Write to direct connection
        session.connection.write(Buffer.from(data));
      } else {
        console.error(
          `[TerminalGateway] Session ${session_id} has no connection or agent`
        );
      }
    } catch (error) {
      console.error(
        `[TerminalGateway] Error sending input for session ${session_id}:`,
        error
      );
    }
  }

  /**
   * Handle data from terminal connection
   */
  private handleConnectionData(sessionId: string, data: Buffer): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = new Date();

    // Send output to client
    const message: TerminalOutputMessage = {
      type: 'terminal:output',
      session_id: sessionId,
      data: data.toString('utf-8'),
      timestamp: Date.now(),
    };

    this.sendToClient(session.clientWs, message);
  }

  // ==========================================================================
  // Resize Handling
  // ==========================================================================

  /**
   * Handle resize request from web client
   */
  private handleResize(ws: WebSocket, message: TerminalResizeMessage): void {
    const { session_id, cols, rows } = message;
    const session = this.activeSessions.get(session_id);

    if (!session) {
      console.warn(
        `[TerminalGateway] Resize for unknown session: ${session_id}`
      );
      return;
    }

    session.lastActivity = new Date();

    try {
      if (session.connectionType === 'reverse' && session.agentId) {
        // Forward to agent
        agentHandler.sendResize(session.agentId, session_id, cols, rows);
      } else if (session.connection) {
        // Resize direct connection
        session.connection.resize(cols, rows);
      }

      console.log(
        `[TerminalGateway] Resized session ${session_id} to ${cols}x${rows}`
      );
    } catch (error) {
      console.error(
        `[TerminalGateway] Error resizing session ${session_id}:`,
        error
      );
    }
  }

  // ==========================================================================
  // Disconnection Handling
  // ==========================================================================

  /**
   * Handle disconnect request from web client
   */
  private handleDisconnect(
    ws: WebSocket,
    message: TerminalDisconnectMessage
  ): void {
    const { session_id } = message;
    this.cleanupSession(session_id);
  }

  /**
   * Handle web client WebSocket disconnect
   */
  private handleClientDisconnect(ws: WebSocket): void {
    const sessionId = this.clientToSession.get(ws);
    if (sessionId) {
      console.log(
        `[TerminalGateway] Client disconnected from session ${sessionId}`
      );
      this.cleanupSession(sessionId);
    }
  }

  /**
   * Handle terminal connection close
   */
  private handleConnectionClose(sessionId: string): void {
    console.log(
      `[TerminalGateway] Terminal connection closed for session ${sessionId}`
    );

    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.sendStatus(session.clientWs, sessionId, 'disconnected', {
        message: 'Terminal connection closed',
      });
      this.cleanupSession(sessionId);
    }
  }

  /**
   * Handle terminal connection error
   */
  private handleConnectionError(sessionId: string, error: Error): void {
    console.error(
      `[TerminalGateway] Terminal connection error for session ${sessionId}:`,
      error
    );

    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.sendError(session.clientWs, sessionId, error.message, error);
    }
  }

  /**
   * Clean up a terminal session
   */
  private async cleanupSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      // Clean up based on connection type
      if (session.connectionType === 'reverse' && session.agentId) {
        // Detach from agent registry
        agentRegistry.detachClientFromSession(sessionId, session.clientWs);

        // Send disconnect command to agent
        agentHandler.sendDisconnect(session.agentId, sessionId);
      } else if (session.connection) {
        // Close direct connection
        session.connection.close();
      }

      // Remove from tracking maps
      this.activeSessions.delete(sessionId);
      this.clientToSession.delete(session.clientWs);

      // Update database status
      await updateSessionLocation(sessionId, {
        status: 'inactive',
      }).catch((error) => {
        console.error(
          `[TerminalGateway] Error updating session location status:`,
          error
        );
      });

      console.log(`[TerminalGateway] Cleaned up session ${sessionId}`);
    } catch (error) {
      console.error(
        `[TerminalGateway] Error cleaning up session ${sessionId}:`,
        error
      );
    }
  }

  // ==========================================================================
  // Messaging Utilities
  // ==========================================================================

  /**
   * Send a message to a web client
   */
  private sendToClient(ws: WebSocket, message: any): void {
    try {
      if (ws.readyState === 1) {
        // WebSocket.OPEN
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error('[TerminalGateway] Error sending to client:', error);
    }
  }

  /**
   * Send status update to client
   */
  private sendStatus(
    ws: WebSocket,
    sessionId: string,
    status: 'connected' | 'disconnected' | 'error' | 'connecting',
    options?: {
      message?: string;
      connection_type?: string;
      agent_id?: string;
    }
  ): void {
    const message: TerminalStatusMessage = {
      type: 'terminal:status',
      session_id: sessionId,
      status,
      message: options?.message,
      connection_type: options?.connection_type as any,
      agent_id: options?.agent_id,
      timestamp: Date.now(),
    };

    this.sendToClient(ws, message);
  }

  /**
   * Send error message to client
   */
  private sendError(
    ws: WebSocket,
    sessionId: string,
    error: string,
    details?: any
  ): void {
    const message: TerminalErrorMessage = {
      type: 'terminal:error',
      session_id: sessionId,
      error,
      details,
      timestamp: Date.now(),
    };

    this.sendToClient(ws, message);
  }

  /**
   * Broadcast message to all clients viewing a session
   */
  broadcastToSession(sessionId: string, message: any): void {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.sendToClient(session.clientWs, message);
    }
  }

  // ==========================================================================
  // Statistics and Status
  // ==========================================================================

  /**
   * Get statistics about active connections
   */
  getActiveConnections() {
    const stats = {
      totalSessions: this.activeSessions.size,
      byType: {
        local: 0,
        ssh: 0,
        docker: 0,
        reverse: 0,
      },
      sessions: Array.from(this.activeSessions.values()).map((session) => ({
        sessionId: session.sessionId,
        projectId: session.projectId,
        connectionType: session.connectionType,
        agentId: session.agentId,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
      })),
    };

    // Count by type
    for (const session of this.activeSessions.values()) {
      stats.byType[session.connectionType]++;
    }

    return stats;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global singleton instance of the terminal gateway
 */
export const terminalGateway = new TerminalGateway();

// ============================================================================
// Handler Functions for Easy Integration
// ============================================================================

/**
 * Main WebSocket handler that routes to appropriate handler based on path
 *
 * @param ws - WebSocket connection
 * @param path - Connection path ('/terminal' or '/agent')
 */
export function handleTerminalWebSocket(ws: WebSocket, path: string): void {
  if (path === '/agent') {
    // Agent connection - delegate to agent handler
    handleAgentConnection(ws);
  } else {
    // Web client connection - handle in gateway
    terminalGateway.handleClientConnection(ws);
  }
}
