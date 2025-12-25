/**
 * Distributed Terminal Gateway Types
 *
 * This module defines all TypeScript interfaces and types for the terminal gateway system,
 * including WebSocket message protocols for both web clients and remote agents.
 */

// ============================================================================
// Connection Types
// ============================================================================

/**
 * Types of terminal connections supported by the gateway
 */
export type ConnectionType = 'local' | 'ssh' | 'docker' | 'reverse';

/**
 * Status of a session location
 */
export type SessionLocationStatus = 'active' | 'inactive' | 'error' | 'connecting';

// ============================================================================
// Database Schema Types
// ============================================================================

/**
 * Session location information stored in the database.
 * Represents where a Claude session's terminal is actually running.
 */
export interface SessionLocation {
  // Core identification
  id: number;
  session_id: string;
  project_id: string;
  connection_type: ConnectionType;

  // SSH connection parameters
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;

  // Docker connection parameters
  docker_container_id?: string;

  // Tmux parameters (for any connection type)
  tmux_session_name?: string;
  tmux_window_name?: string;

  // Reverse tunnel parameters (for remote agents)
  reverse_agent_id?: string;
  reverse_agent_secret?: string;

  // Status tracking
  status: SessionLocationStatus;
  last_heartbeat_at?: Date;
  last_verified_at?: Date;

  // Timestamps
  created_at: Date;
  updated_at: Date;
}

/**
 * Input parameters for creating a new session location
 */
export interface CreateSessionLocationParams {
  session_id: string;
  project_id: string;
  connection_type: ConnectionType;
  ssh_host?: string;
  ssh_port?: number;
  ssh_username?: string;
  docker_container_id?: string;
  tmux_session_name?: string;
  tmux_window_name?: string;
  reverse_agent_id?: string;
  reverse_agent_secret?: string;
  status?: SessionLocationStatus;
}

// ============================================================================
// Web Client ↔ Gateway Messages
// ============================================================================

/**
 * Base message structure for all WebSocket messages
 */
interface BaseMessage {
  type: string;
  timestamp?: number;
}

/**
 * Client requests to connect to a terminal session
 */
export interface TerminalConnectMessage extends BaseMessage {
  type: 'terminal:connect';
  session_id: string;
  project_id: string;
  cols?: number;
  rows?: number;
}

/**
 * Client sends input (keystrokes) to the terminal
 */
export interface TerminalInputMessage extends BaseMessage {
  type: 'terminal:input';
  session_id: string;
  data: string;
}

/**
 * Client notifies gateway of terminal resize
 */
export interface TerminalResizeMessage extends BaseMessage {
  type: 'terminal:resize';
  session_id: string;
  cols: number;
  rows: number;
}

/**
 * Client disconnects from terminal session
 */
export interface TerminalDisconnectMessage extends BaseMessage {
  type: 'terminal:disconnect';
  session_id: string;
}

/**
 * Gateway sends terminal output to client
 */
export interface TerminalOutputMessage extends BaseMessage {
  type: 'terminal:output';
  session_id: string;
  data: string;
}

/**
 * Gateway sends status updates to client
 */
export interface TerminalStatusMessage extends BaseMessage {
  type: 'terminal:status';
  session_id: string;
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  message?: string;
  connection_type?: ConnectionType;
  agent_id?: string;
}

/**
 * Gateway sends error messages to client
 */
export interface TerminalErrorMessage extends BaseMessage {
  type: 'terminal:error';
  session_id: string;
  error: string;
  details?: any;
}

// ============================================================================
// Agent ↔ Gateway Messages
// ============================================================================

/**
 * Agent registers itself with the gateway
 */
export interface AgentRegisterMessage extends BaseMessage {
  type: 'agent:register';
  agent_id: string;
  agent_secret: string;
  hostname?: string;
  platform?: string;
  version?: string;
}

/**
 * Agent sends periodic heartbeat to maintain connection
 */
export interface AgentHeartbeatMessage extends BaseMessage {
  type: 'agent:heartbeat';
  agent_id: string;
  active_sessions: string[];
  system_info?: {
    cpu_usage?: number;
    memory_usage?: number;
    uptime?: number;
  };
}

/**
 * Agent notifies gateway that a new session has started
 */
export interface AgentSessionStartMessage extends BaseMessage {
  type: 'agent:session:start';
  agent_id: string;
  session_id: string;
  project_id: string;
  tmux_session_name?: string;
  tmux_window_name?: string;
}

/**
 * Agent notifies gateway that a session has ended
 */
export interface AgentSessionEndMessage extends BaseMessage {
  type: 'agent:session:end';
  agent_id: string;
  session_id: string;
  reason?: string;
}

/**
 * Agent sends terminal output to gateway
 */
export interface AgentOutputMessage extends BaseMessage {
  type: 'agent:session:output';
  session_id: string;
  data: string;
}

/**
 * Agent sends error information to gateway
 */
export interface AgentErrorMessage extends BaseMessage {
  type: 'agent:session:error';
  session_id?: string;
  error: string;
  details?: any;
}

/**
 * Gateway commands agent to connect to a terminal
 */
export interface AgentConnectCommand extends BaseMessage {
  type: 'agent:command:connect';
  session_id: string;
  tmux_session_name?: string;
  tmux_window_name?: string;
  cols?: number;
  rows?: number;
}

/**
 * Gateway sends input to agent for terminal
 */
export interface AgentInputCommand extends BaseMessage {
  type: 'agent:command:input';
  session_id: string;
  data: string;
}

/**
 * Gateway commands agent to resize terminal
 */
export interface AgentResizeCommand extends BaseMessage {
  type: 'agent:command:resize';
  session_id: string;
  cols: number;
  rows: number;
}

/**
 * Gateway commands agent to disconnect from terminal
 */
export interface AgentDisconnectCommand extends BaseMessage {
  type: 'agent:command:disconnect';
  session_id: string;
}

/**
 * Gateway pings agent to check connectivity
 */
export interface AgentPingCommand extends BaseMessage {
  type: 'agent:command:ping';
}

/**
 * Agent acknowledges a command from gateway
 */
export interface AgentAckMessage extends BaseMessage {
  type: 'agent:ack';
  command_type: string;
  session_id?: string;
  success: boolean;
  message?: string;
}

/**
 * Gateway confirms agent registration
 */
export interface AgentRegisteredMessage extends BaseMessage {
  type: 'agent:registered';
  agent_id: string;
  message: string;
}

/**
 * Gateway sends pong response to agent heartbeat
 */
export interface AgentPongMessage extends BaseMessage {
  type: 'agent:pong';
}

/**
 * Gateway sends error response to agent
 */
export interface GatewayErrorMessage extends BaseMessage {
  type: 'gateway:error';
  error: string;
  details?: any;
}

// ============================================================================
// Union Types for Message Handling
// ============================================================================

/**
 * All possible messages from web client to gateway
 */
export type TerminalClientMessage =
  | TerminalConnectMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalDisconnectMessage;

/**
 * All possible messages from gateway to web client
 */
export type TerminalServerMessage =
  | TerminalOutputMessage
  | TerminalStatusMessage
  | TerminalErrorMessage;

/**
 * All possible messages from agent to gateway
 */
export type AgentToGatewayMessage =
  | AgentRegisterMessage
  | AgentHeartbeatMessage
  | AgentSessionStartMessage
  | AgentSessionEndMessage
  | AgentOutputMessage
  | AgentErrorMessage
  | AgentAckMessage;

/**
 * All possible messages from gateway to agent
 */
export type GatewayToAgentMessage =
  | AgentConnectCommand
  | AgentInputCommand
  | AgentResizeCommand
  | AgentDisconnectCommand
  | AgentPingCommand
  | AgentRegisteredMessage
  | AgentPongMessage
  | GatewayErrorMessage;

// ============================================================================
// Gateway Internal Types
// ============================================================================

/**
 * Connection state for a web client
 */
export interface ClientConnection {
  id: string;
  ws: any; // WebSocket instance
  session_id?: string;
  project_id?: string;
  connected_at: Date;
  last_activity: Date;
}

/**
 * Connection state for a remote agent
 */
export interface AgentConnection {
  agent_id: string;
  ws: any; // WebSocket instance
  agent_secret: string;
  hostname?: string;
  platform?: string;
  version?: string;
  active_sessions: Set<string>;
  connected_at: Date;
  last_heartbeat: Date;
}

/**
 * Terminal session state managed by gateway
 */
export interface TerminalSession {
  session_id: string;
  project_id: string;
  connection_type: ConnectionType;

  // Client connection
  client_id?: string;

  // For reverse tunnel connections
  agent_id?: string;

  // For SSH/Docker connections
  pty?: any; // node-pty instance

  // Terminal dimensions
  cols: number;
  rows: number;

  // Status
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;

  // Timestamps
  created_at: Date;
  last_activity: Date;
}

/**
 * Configuration for SSH connections
 */
export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  tmux_session_name?: string;
  tmux_window_name?: string;
}

/**
 * Configuration for Docker connections
 */
export interface DockerConfig {
  container_id: string;
  tmux_session_name?: string;
  tmux_window_name?: string;
}

/**
 * Configuration for local connections
 */
export interface LocalConfig {
  tmux_session_name?: string;
  tmux_window_name?: string;
  shell?: string;
}

/**
 * Configuration for reverse tunnel connections
 */
export interface ReverseConfig {
  agent_id: string;
  agent_secret: string;
  tmux_session_name?: string;
  tmux_window_name?: string;
}

/**
 * Union type for all connection configurations
 */
export type ConnectionConfig = SSHConfig | DockerConfig | LocalConfig | ReverseConfig;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for terminal client messages
 */
export function isTerminalClientMessage(msg: any): msg is TerminalClientMessage {
  return msg && typeof msg.type === 'string' && msg.type.startsWith('terminal:');
}

/**
 * Type guard for agent messages
 */
export function isAgentToGatewayMessage(msg: any): msg is AgentToGatewayMessage {
  return msg && typeof msg.type === 'string' && msg.type.startsWith('agent:') &&
         !msg.type.startsWith('agent:command:');
}

/**
 * Type guard for SSH config
 */
export function isSSHConfig(config: ConnectionConfig): config is SSHConfig {
  return 'host' in config && 'port' in config && 'username' in config;
}

/**
 * Type guard for Docker config
 */
export function isDockerConfig(config: ConnectionConfig): config is DockerConfig {
  return 'container_id' in config;
}

/**
 * Type guard for Reverse config
 */
export function isReverseConfig(config: ConnectionConfig): config is ReverseConfig {
  return 'agent_id' in config && 'agent_secret' in config;
}

/**
 * Type guard for Local config
 */
export function isLocalConfig(config: ConnectionConfig): config is LocalConfig {
  return !isSSHConfig(config) && !isDockerConfig(config) && !isReverseConfig(config);
}
