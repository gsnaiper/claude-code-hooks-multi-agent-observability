/**
 * Terminal Location Registry
 *
 * Manages session location information for the distributed terminal gateway.
 * Tracks where each Claude session's terminal is actually running (local, SSH, Docker, or reverse tunnel).
 *
 * This module provides CRUD operations for session_locations table, including:
 * - Creating and updating session location records
 * - Querying locations by session, agent, or connection type
 * - Heartbeat tracking to detect stale/disconnected sessions
 * - Filtering and listing operations
 */

import type {
  SessionLocation,
  CreateSessionLocationParams,
  ConnectionType,
  SessionLocationStatus
} from './types';
import * as db from '../db';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Database row structure for session_locations table
 * (matches SQLite/Postgres schema)
 */
interface SessionLocationRow {
  id: number;
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
  status: SessionLocationStatus;
  last_heartbeat_at?: number;
  last_verified_at?: number;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert database row to SessionLocation object
 */
function rowToSessionLocation(row: SessionLocationRow): SessionLocation {
  return {
    id: row.id,
    session_id: row.session_id,
    project_id: row.project_id,
    connection_type: row.connection_type,
    ssh_host: row.ssh_host,
    ssh_port: row.ssh_port,
    ssh_username: row.ssh_username,
    docker_container_id: row.docker_container_id,
    tmux_session_name: row.tmux_session_name,
    tmux_window_name: row.tmux_window_name,
    reverse_agent_id: row.reverse_agent_id,
    reverse_agent_secret: row.reverse_agent_secret,
    status: row.status,
    last_heartbeat_at: row.last_heartbeat_at ? new Date(row.last_heartbeat_at) : undefined,
    last_verified_at: row.last_verified_at ? new Date(row.last_verified_at) : undefined,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at)
  };
}

/**
 * Get database adapter instance
 * This is a temporary helper until we add session_locations to the adapter interface
 */
function getDbAdapter(): any {
  // Access internal adapter through the module
  // This will be replaced once we add proper methods to DatabaseAdapter interface
  const dbModule = db as any;
  return dbModule.adapter || (dbModule as any).db || null;
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new session location record
 */
export async function createSessionLocation(
  params: CreateSessionLocationParams
): Promise<SessionLocation> {
  const id = crypto.randomUUID(); // crypto is available globally in modern runtimes
  const now = Date.now();
  const status = params.status || 'connecting';

  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  const query = adapter.db.prepare(`
    INSERT INTO session_locations (
      id, session_id, project_id, connection_type,
      ssh_host, ssh_port, ssh_username,
      docker_container_id,
      tmux_session_name, tmux_window_name,
      reverse_agent_id, reverse_agent_secret,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = query.get(
    id,
    params.session_id,
    params.project_id,
    params.connection_type,
    params.ssh_host || null,
    params.ssh_port || null,
    params.ssh_username || null,
    params.docker_container_id || null,
    params.tmux_session_name || null,
    params.tmux_window_name || null,
    params.reverse_agent_id || null,
    params.reverse_agent_secret || null,
    status,
    now,
    now
  ) as SessionLocationRow;

  return rowToSessionLocation(row);
}

/**
 * Get session location by session ID
 */
export async function getSessionLocation(
  sessionId: string
): Promise<SessionLocation | null> {
  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  const query = adapter.db.prepare(`
    SELECT * FROM session_locations
    WHERE session_id = ?
    LIMIT 1
  `);

  const row = query.get(sessionId) as SessionLocationRow | undefined;
  return row ? rowToSessionLocation(row) : null;
}

/**
 * Get all session locations for a specific agent
 */
export async function getSessionLocationsByAgent(
  agentId: string
): Promise<SessionLocation[]> {
  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  const query = adapter.db.prepare(`
    SELECT * FROM session_locations
    WHERE reverse_agent_id = ?
    ORDER BY created_at DESC
  `);

  const rows = query.all(agentId) as SessionLocationRow[];
  return rows.map(rowToSessionLocation);
}

/**
 * Update session location fields
 */
export async function updateSessionLocation(
  sessionId: string,
  updates: Partial<SessionLocation>
): Promise<SessionLocation | null> {
  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  // Build dynamic SET clause based on provided updates
  const allowedFields = [
    'status',
    'ssh_host',
    'ssh_port',
    'ssh_username',
    'docker_container_id',
    'tmux_session_name',
    'tmux_window_name',
    'reverse_agent_id',
    'reverse_agent_secret',
    'last_heartbeat_at',
    'last_verified_at'
  ];

  const setClauses: string[] = [];
  const values: any[] = [];

  for (const field of allowedFields) {
    if (field in updates) {
      setClauses.push(`${field} = ?`);
      let value = (updates as any)[field];

      // Convert Date objects to timestamps
      if (value instanceof Date) {
        value = value.getTime();
      }

      values.push(value);
    }
  }

  if (setClauses.length === 0) {
    // No valid updates provided, just return current record
    return getSessionLocation(sessionId);
  }

  // Always update updated_at
  setClauses.push('updated_at = ?');
  values.push(Date.now());

  // Add session_id for WHERE clause
  values.push(sessionId);

  const query = adapter.db.prepare(`
    UPDATE session_locations
    SET ${setClauses.join(', ')}
    WHERE session_id = ?
    RETURNING *
  `);

  const row = query.get(...values) as SessionLocationRow | undefined;
  return row ? rowToSessionLocation(row) : null;
}

/**
 * Delete session location by session ID
 */
export async function deleteSessionLocation(sessionId: string): Promise<boolean> {
  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  const query = adapter.db.prepare(`
    DELETE FROM session_locations
    WHERE session_id = ?
  `);

  const result = query.run(sessionId);
  return (result as any).changes > 0;
}

/**
 * List session locations with optional filters
 */
export async function listSessionLocations(filter?: {
  connectionType?: ConnectionType;
  status?: string;
}): Promise<SessionLocation[]> {
  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  const whereClauses: string[] = [];
  const values: any[] = [];

  if (filter?.connectionType) {
    whereClauses.push('connection_type = ?');
    values.push(filter.connectionType);
  }

  if (filter?.status) {
    whereClauses.push('status = ?');
    values.push(filter.status);
  }

  const whereClause = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(' AND ')}`
    : '';

  const query = adapter.db.prepare(`
    SELECT * FROM session_locations
    ${whereClause}
    ORDER BY created_at DESC
  `);

  const rows = (values.length > 0 ? query.all(...values) : query.all()) as SessionLocationRow[];
  return rows.map(rowToSessionLocation);
}

/**
 * Update heartbeat timestamp for all sessions belonging to an agent
 */
export async function updateHeartbeat(agentId: string): Promise<void> {
  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  const now = Date.now();

  const query = adapter.db.prepare(`
    UPDATE session_locations
    SET last_heartbeat_at = ?, updated_at = ?
    WHERE reverse_agent_id = ?
  `);

  query.run(now, now, agentId);
}

/**
 * Get session locations with stale heartbeats (potential disconnects)
 * @param timeoutMs - Maximum age of last heartbeat in milliseconds
 */
export async function getStaleAgentSessions(
  timeoutMs: number
): Promise<SessionLocation[]> {
  const adapter = getDbAdapter();
  if (!adapter || !adapter.db) {
    throw new Error('Database adapter not initialized');
  }

  const cutoffTime = Date.now() - timeoutMs;

  const query = adapter.db.prepare(`
    SELECT * FROM session_locations
    WHERE connection_type = 'reverse'
      AND status = 'active'
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)
    ORDER BY CASE WHEN last_heartbeat_at IS NULL THEN 0 ELSE 1 END, last_heartbeat_at ASC
  `);

  const rows = query.all(cutoffTime) as SessionLocationRow[];
  return rows.map(rowToSessionLocation);
}
