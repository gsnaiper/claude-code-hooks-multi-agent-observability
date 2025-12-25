/**
 * Agent Registry
 *
 * In-memory registry for managing connected agents in the distributed terminal gateway.
 * Provides real-time tracking of agent connections, sessions, and client attachments.
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Session information for a connected agent
 */
interface SessionInfo {
  tmuxTarget: string;
  projectId?: string;
  attachedClients: Set<WebSocket>;
}

/**
 * Connected agent information
 */
interface ConnectedAgent {
  agentId: string;
  ws: WebSocket;
  connectedAt: number;
  lastHeartbeat: number;
  sessions: Map<string, SessionInfo>;
}

// ============================================================================
// Event Types
// ============================================================================

interface AgentRegistryEvents {
  'agent:connected': (agentId: string, agent: ConnectedAgent) => void;
  'agent:disconnected': (agentId: string, agent: ConnectedAgent) => void;
  'session:started': (agentId: string, sessionId: string, sessionInfo: SessionInfo) => void;
  'session:ended': (agentId: string, sessionId: string) => void;
}

// ============================================================================
// Agent Registry Class
// ============================================================================

/**
 * Registry for managing connected agents and their sessions
 */
class AgentRegistry extends EventEmitter {
  private agents: Map<string, ConnectedAgent>;
  private sessionToAgent: Map<string, string>; // sessionId -> agentId mapping

  constructor() {
    super();
    this.agents = new Map();
    this.sessionToAgent = new Map();
  }

  /**
   * Register a new agent connection
   */
  registerAgent(agentId: string, ws: WebSocket): void {
    const now = Date.now();

    // If agent already exists, clean up old connection
    if (this.agents.has(agentId)) {
      const oldAgent = this.agents.get(agentId)!;
      this.unregisterAgent(agentId);
    }

    const agent: ConnectedAgent = {
      agentId,
      ws,
      connectedAt: now,
      lastHeartbeat: now,
      sessions: new Map(),
    };

    this.agents.set(agentId, agent);
    this.emit('agent:connected', agentId, agent);
  }

  /**
   * Unregister an agent and clean up all its sessions
   */
  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    // Clean up all sessions for this agent
    for (const sessionId of agent.sessions.keys()) {
      this.unregisterSession(agentId, sessionId);
    }

    this.agents.delete(agentId);
    this.emit('agent:disconnected', agentId, agent);
  }

  /**
   * Get a connected agent by ID
   */
  getAgent(agentId: string): ConnectedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Check if an agent is currently online
   */
  isAgentOnline(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Register a new session for an agent
   */
  registerSession(
    agentId: string,
    sessionId: string,
    tmuxTarget: string,
    projectId?: string
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const sessionInfo: SessionInfo = {
      tmuxTarget,
      projectId,
      attachedClients: new Set(),
    };

    agent.sessions.set(sessionId, sessionInfo);
    this.sessionToAgent.set(sessionId, agentId);

    this.emit('session:started', agentId, sessionId, sessionInfo);
  }

  /**
   * Unregister a session from an agent
   */
  unregisterSession(agentId: string, sessionId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    const sessionInfo = agent.sessions.get(sessionId);
    if (!sessionInfo) {
      return;
    }

    // Clean up all attached clients
    sessionInfo.attachedClients.clear();

    agent.sessions.delete(sessionId);
    this.sessionToAgent.delete(sessionId);

    this.emit('session:ended', agentId, sessionId);
  }

  /**
   * Get the agent that owns a specific session
   */
  getAgentForSession(sessionId: string): ConnectedAgent | undefined {
    const agentId = this.sessionToAgent.get(sessionId);
    if (!agentId) {
      return undefined;
    }
    return this.agents.get(agentId);
  }

  /**
   * Attach a web client to a session
   * @returns true if successful, false if session not found
   */
  attachClientToSession(sessionId: string, clientWs: WebSocket): boolean {
    const agentId = this.sessionToAgent.get(sessionId);
    if (!agentId) {
      return false;
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    const sessionInfo = agent.sessions.get(sessionId);
    if (!sessionInfo) {
      return false;
    }

    sessionInfo.attachedClients.add(clientWs);
    return true;
  }

  /**
   * Detach a web client from a session
   */
  detachClientFromSession(sessionId: string, clientWs: WebSocket): void {
    const agentId = this.sessionToAgent.get(sessionId);
    if (!agentId) {
      return;
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    const sessionInfo = agent.sessions.get(sessionId);
    if (!sessionInfo) {
      return;
    }

    sessionInfo.attachedClients.delete(clientWs);
  }

  /**
   * Update the heartbeat timestamp for an agent
   */
  updateHeartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    agent.lastHeartbeat = Date.now();
  }

  /**
   * Get a list of all online agents
   */
  getOnlineAgents(): ConnectedAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Clean up agents that haven't sent heartbeat in specified time
   * @param heartbeatTimeoutMs Timeout in milliseconds
   * @returns Array of removed agent IDs
   */
  cleanup(heartbeatTimeoutMs: number): string[] {
    const now = Date.now();
    const removedAgents: string[] = [];

    for (const [agentId, agent] of this.agents.entries()) {
      if (now - agent.lastHeartbeat > heartbeatTimeoutMs) {
        this.unregisterAgent(agentId);
        removedAgents.push(agentId);
      }
    }

    return removedAgents;
  }

  /**
   * Get session info for a specific session
   */
  getSessionInfo(sessionId: string): SessionInfo | undefined {
    const agentId = this.sessionToAgent.get(sessionId);
    if (!agentId) {
      return undefined;
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      return undefined;
    }

    return agent.sessions.get(sessionId);
  }

  /**
   * Get all sessions for a specific agent
   */
  getAgentSessions(agentId: string): Map<string, SessionInfo> | undefined {
    const agent = this.agents.get(agentId);
    return agent?.sessions;
  }

  /**
   * Get statistics about the registry
   */
  getStats() {
    let totalSessions = 0;
    let totalClients = 0;

    for (const agent of this.agents.values()) {
      totalSessions += agent.sessions.size;
      for (const session of agent.sessions.values()) {
        totalClients += session.attachedClients.size;
      }
    }

    return {
      agentCount: this.agents.size,
      sessionCount: totalSessions,
      clientCount: totalClients,
    };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global singleton instance of the agent registry
 */
export const agentRegistry = new AgentRegistry();

// ============================================================================
// Type Exports
// ============================================================================

export type { ConnectedAgent, SessionInfo, AgentRegistryEvents };
