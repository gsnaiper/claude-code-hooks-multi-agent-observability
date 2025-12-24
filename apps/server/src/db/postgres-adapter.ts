/**
 * PostgreSQL Database Adapter
 *
 * Implementation of DatabaseAdapter using Bun's native Postgres driver (bun:sql).
 * Used when DATABASE_URL environment variable is set to a postgres:// connection string.
 *
 * Features:
 * - JSONB for efficient payload/chat storage
 * - Connection pooling (automatic via bun:sql)
 * - TIMESTAMPTZ for proper timezone handling
 * - GIN indexes for fast JSON queries
 */

import { sql, SQL } from 'bun';
import type { DatabaseAdapter, AudioCacheEntry } from './adapter';
import type {
  HookEvent,
  FilterOptions,
  Theme,
  ThemeSearchQuery,
  Project,
  ProjectSession,
  ProjectSearchQuery
} from '../types';

export class PostgresAdapter implements DatabaseAdapter {
  private db!: SQL;

  constructor(private connectionString: string) {}

  // ============================================
  // Lifecycle
  // ============================================

  init(): void {
    // Bun.sql creates a connection pool automatically
    this.db = sql(this.connectionString);
    console.log('[Postgres] Connected to database');
  }

  close(): void {
    // Bun.sql handles connection cleanup automatically
    console.log('[Postgres] Connection closed');
  }

  // ============================================
  // Event Operations
  // ============================================

  insertEvent(event: HookEvent): HookEvent {
    const timestamp = event.timestamp || Date.now();

    // Initialize humanInTheLoopStatus to pending if humanInTheLoop exists
    let humanInTheLoopStatus = event.humanInTheLoopStatus;
    if (event.humanInTheLoop && !humanInTheLoopStatus) {
      humanInTheLoopStatus = { status: 'pending' };
    }

    const result = this.db`
      INSERT INTO events (
        source_app, session_id, project_id, hook_event_type, model_name,
        payload, chat, summary, human_in_the_loop, human_in_the_loop_status, timestamp
      ) VALUES (
        ${event.source_app},
        ${event.session_id},
        ${event.project_id || null},
        ${event.hook_event_type},
        ${event.model_name || null},
        ${JSON.stringify(event.payload)}::jsonb,
        ${event.chat ? JSON.stringify(event.chat) : null}::jsonb,
        ${event.summary || null},
        ${event.humanInTheLoop ? JSON.stringify(event.humanInTheLoop) : null}::jsonb,
        ${humanInTheLoopStatus ? JSON.stringify(humanInTheLoopStatus) : null}::jsonb,
        to_timestamp(${timestamp / 1000})
      )
      RETURNING id, timestamp
    `;

    const row = result[0] as any;

    return {
      ...event,
      id: Number(row.id),
      timestamp,
      humanInTheLoopStatus,
      project_id: event.project_id
    };
  }

  getRecentEvents(limit: number = 300): HookEvent[] {
    const rows = this.db`
      SELECT
        id, source_app, session_id, project_id, hook_event_type, model_name,
        payload, chat, summary, human_in_the_loop, human_in_the_loop_status,
        EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp
      FROM events
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    return (rows as any[]).map(row => this.rowToEvent(row)).reverse();
  }

  getEventsBySessionId(sessionId: string): HookEvent[] {
    const rows = this.db`
      SELECT
        id, source_app, session_id, project_id, hook_event_type, model_name,
        payload, chat, summary, human_in_the_loop, human_in_the_loop_status,
        EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp
      FROM events
      WHERE session_id = ${sessionId}
      ORDER BY timestamp ASC
    `;

    return (rows as any[]).map(row => this.rowToEvent(row));
  }

  getFilterOptions(): FilterOptions {
    const sourceApps = this.db`SELECT DISTINCT source_app FROM events ORDER BY source_app`;
    const sessionIds = this.db`SELECT DISTINCT session_id FROM events ORDER BY session_id DESC LIMIT 300`;
    const hookEventTypes = this.db`SELECT DISTINCT hook_event_type FROM events ORDER BY hook_event_type`;

    return {
      source_apps: (sourceApps as any[]).map(row => row.source_app),
      session_ids: (sessionIds as any[]).map(row => row.session_id),
      hook_event_types: (hookEventTypes as any[]).map(row => row.hook_event_type)
    };
  }

  updateEventHITLResponse(id: number, response: any): HookEvent | null {
    const status = {
      status: 'responded',
      respondedAt: response.respondedAt,
      response
    };

    this.db`
      UPDATE events
      SET human_in_the_loop_status = ${JSON.stringify(status)}::jsonb
      WHERE id = ${id}
    `;

    const rows = this.db`
      SELECT
        id, source_app, session_id, project_id, hook_event_type, model_name,
        payload, chat, summary, human_in_the_loop, human_in_the_loop_status,
        EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp
      FROM events
      WHERE id = ${id}
    `;

    const row = (rows as any[])[0];
    return row ? this.rowToEvent(row) : null;
  }

  private rowToEvent(row: any): HookEvent {
    return {
      id: Number(row.id),
      source_app: row.source_app,
      session_id: row.session_id,
      hook_event_type: row.hook_event_type,
      payload: row.payload, // JSONB is already parsed
      chat: row.chat || undefined,
      summary: row.summary || undefined,
      timestamp: Math.floor(Number(row.timestamp)),
      humanInTheLoop: row.human_in_the_loop || undefined,
      humanInTheLoopStatus: row.human_in_the_loop_status || undefined,
      model_name: row.model_name || undefined,
      project_id: row.project_id || undefined
    };
  }

  // ============================================
  // Theme Operations
  // ============================================

  insertTheme(theme: Theme): Theme {
    this.db`
      INSERT INTO themes (
        id, name, display_name, description, colors, is_public,
        author_id, author_name, created_at, updated_at, tags,
        download_count, rating, rating_count
      ) VALUES (
        ${theme.id},
        ${theme.name},
        ${theme.displayName},
        ${theme.description || null},
        ${JSON.stringify(theme.colors)}::jsonb,
        ${theme.isPublic},
        ${theme.authorId || null},
        ${theme.authorName || null},
        to_timestamp(${theme.createdAt / 1000}),
        to_timestamp(${theme.updatedAt / 1000}),
        ${theme.tags || []}::text[],
        ${theme.downloadCount || 0},
        ${theme.rating || 0},
        ${theme.ratingCount || 0}
      )
    `;

    return theme;
  }

  updateTheme(id: string, updates: Partial<Theme>): boolean {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.displayName !== undefined) {
      setClauses.push(`display_name = $${values.length + 1}`);
      values.push(updates.displayName);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${values.length + 1}`);
      values.push(updates.description);
    }
    if (updates.colors !== undefined) {
      setClauses.push(`colors = $${values.length + 1}::jsonb`);
      values.push(JSON.stringify(updates.colors));
    }
    if (updates.isPublic !== undefined) {
      setClauses.push(`is_public = $${values.length + 1}`);
      values.push(updates.isPublic);
    }
    if (updates.tags !== undefined) {
      setClauses.push(`tags = $${values.length + 1}::text[]`);
      values.push(updates.tags);
    }

    if (setClauses.length === 0) return false;

    // Note: For dynamic updates, we'd need unsafe() or build the query differently
    // For now, use a simpler approach
    const result = this.db`
      UPDATE themes SET
        display_name = COALESCE(${updates.displayName}, display_name),
        description = COALESCE(${updates.description}, description),
        colors = COALESCE(${updates.colors ? JSON.stringify(updates.colors) : null}::jsonb, colors),
        is_public = COALESCE(${updates.isPublic}, is_public),
        tags = COALESCE(${updates.tags}::text[], tags)
      WHERE id = ${id}
    `;

    return true;
  }

  getTheme(id: string): Theme | null {
    const rows = this.db`SELECT * FROM themes WHERE id = ${id}`;
    const row = (rows as any[])[0];
    return row ? this.rowToTheme(row) : null;
  }

  getThemes(query: ThemeSearchQuery = {}): Theme[] {
    // Build dynamic query
    let whereClause = 'WHERE 1=1';
    const conditions: string[] = [];

    if (query.isPublic !== undefined) {
      conditions.push(`is_public = ${query.isPublic}`);
    }
    if (query.authorId) {
      conditions.push(`author_id = '${query.authorId}'`);
    }
    if (query.query) {
      const term = query.query.replace(/'/g, "''");
      conditions.push(`(name ILIKE '%${term}%' OR display_name ILIKE '%${term}%' OR description ILIKE '%${term}%')`);
    }

    if (conditions.length > 0) {
      whereClause += ' AND ' + conditions.join(' AND ');
    }

    const sortBy = query.sortBy || 'created';
    const sortOrder = query.sortOrder || 'desc';
    const sortColumn = {
      name: 'name',
      created: 'created_at',
      updated: 'updated_at',
      downloads: 'download_count',
      rating: 'rating'
    }[sortBy] || 'created_at';

    // For complex queries with dynamic WHERE, we use unsafe
    const sql = `
      SELECT * FROM themes ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}
      ${query.limit ? `LIMIT ${query.limit}` : ''}
      ${query.offset ? `OFFSET ${query.offset}` : ''}
    `;

    const rows = this.db.unsafe(sql);
    return (rows as any[]).map(row => this.rowToTheme(row));
  }

  deleteTheme(id: string): boolean {
    this.db`DELETE FROM themes WHERE id = ${id}`;
    return true;
  }

  incrementThemeDownloadCount(id: string): boolean {
    this.db`UPDATE themes SET download_count = download_count + 1 WHERE id = ${id}`;
    return true;
  }

  private rowToTheme(row: any): Theme {
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      colors: row.colors,
      isPublic: row.is_public,
      authorId: row.author_id,
      authorName: row.author_name,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      tags: row.tags || [],
      downloadCount: row.download_count,
      rating: row.rating,
      ratingCount: row.rating_count
    };
  }

  // ============================================
  // Audio Cache Operations
  // ============================================

  insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): AudioCacheEntry {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db`
      INSERT INTO audio_cache (
        id, key, audio_data, mime_type, voice_id, text_hash,
        source_app, created_at, accessed_at, access_count, size_bytes
      ) VALUES (
        ${id},
        ${entry.key},
        ${entry.audioData},
        ${entry.mimeType || 'audio/mpeg'},
        ${entry.voiceId || null},
        ${entry.textHash || null},
        ${entry.sourceApp || null},
        NOW(),
        NOW(),
        1,
        ${entry.sizeBytes || null}
      )
    `;

    return {
      id,
      key: entry.key,
      audioData: entry.audioData,
      mimeType: entry.mimeType || 'audio/mpeg',
      voiceId: entry.voiceId,
      textHash: entry.textHash,
      sourceApp: entry.sourceApp,
      createdAt: now,
      accessedAt: now,
      accessCount: 1,
      sizeBytes: entry.sizeBytes
    };
  }

  getAudioCacheByKey(key: string): AudioCacheEntry | null {
    const rows = this.db`SELECT * FROM audio_cache WHERE key = ${key}`;
    const row = (rows as any[])[0];

    if (!row) return null;

    // Update access stats
    this.db`UPDATE audio_cache SET accessed_at = NOW(), access_count = access_count + 1 WHERE id = ${row.id}`;

    return {
      id: row.id,
      key: row.key,
      audioData: row.audio_data,
      mimeType: row.mime_type,
      voiceId: row.voice_id,
      textHash: row.text_hash,
      sourceApp: row.source_app,
      createdAt: new Date(row.created_at).getTime(),
      accessedAt: new Date(row.accessed_at).getTime(),
      accessCount: row.access_count,
      sizeBytes: row.size_bytes
    };
  }

  getAudioCacheStats(): { count: number; totalSize: number; keys: string[] } {
    const countResult = this.db`SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total FROM audio_cache`;
    const keysResult = this.db`SELECT key FROM audio_cache ORDER BY accessed_at DESC LIMIT 100`;

    const stats = (countResult as any[])[0];
    return {
      count: Number(stats?.count) || 0,
      totalSize: Number(stats?.total) || 0,
      keys: (keysResult as any[]).map(r => r.key)
    };
  }

  deleteOldAudioCache(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();
    const result = this.db`DELETE FROM audio_cache WHERE accessed_at < ${cutoffDate}::timestamptz`;
    return 0; // Bun.sql doesn't return affected rows easily
  }

  // ============================================
  // Project Operations
  // ============================================

  getProject(id: string): Project | null {
    const rows = this.db`SELECT * FROM projects WHERE id = ${id}`;
    const row = (rows as any[])[0];
    return row ? this.rowToProject(row) : null;
  }

  insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project {
    const now = Date.now();

    this.db`
      INSERT INTO projects (
        id, display_name, description, git_remote_url, local_path,
        created_at, updated_at, last_session_id, last_activity_at, status, metadata
      ) VALUES (
        ${project.id},
        ${project.displayName || null},
        ${project.description || null},
        ${project.gitRemoteUrl || null},
        ${project.localPath || null},
        NOW(),
        NOW(),
        ${project.lastSessionId || null},
        ${project.lastActivityAt ? new Date(project.lastActivityAt).toISOString() : null}::timestamptz,
        ${project.status || 'active'},
        ${project.metadata ? JSON.stringify(project.metadata) : null}::jsonb
      )
    `;

    return {
      ...project,
      createdAt: now,
      updatedAt: now
    };
  }

  updateProject(id: string, updates: Partial<Project>): Project | null {
    const validStatuses = ['active', 'archived', 'paused'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      throw new Error(`Invalid project status: ${updates.status}`);
    }

    const project = this.getProject(id);
    if (!project) return null;

    const now = Date.now();
    const updatedProject = { ...project, ...updates, updatedAt: now };

    this.db`
      UPDATE projects SET
        display_name = ${updatedProject.displayName || null},
        description = ${updatedProject.description || null},
        git_remote_url = ${updatedProject.gitRemoteUrl || null},
        local_path = ${updatedProject.localPath || null},
        updated_at = NOW(),
        last_session_id = ${updatedProject.lastSessionId || null},
        last_activity_at = ${updatedProject.lastActivityAt ? new Date(updatedProject.lastActivityAt).toISOString() : null}::timestamptz,
        status = ${updatedProject.status},
        metadata = ${updatedProject.metadata ? JSON.stringify(updatedProject.metadata) : null}::jsonb
      WHERE id = ${id}
    `;

    return updatedProject;
  }

  listProjects(query: ProjectSearchQuery = {}): Project[] {
    let whereClause = 'WHERE 1=1';
    const conditions: string[] = [];

    if (query.status) {
      conditions.push(`status = '${query.status}'`);
    }
    if (query.query) {
      const term = query.query.replace(/'/g, "''");
      conditions.push(`(id ILIKE '%${term}%' OR display_name ILIKE '%${term}%' OR description ILIKE '%${term}%')`);
    }

    if (conditions.length > 0) {
      whereClause += ' AND ' + conditions.join(' AND ');
    }

    const sortBy = query.sortBy || 'lastActivity';
    const sortOrder = query.sortOrder || 'desc';
    const sortColumn = {
      name: 'display_name',
      created: 'created_at',
      updated: 'updated_at',
      lastActivity: 'last_activity_at'
    }[sortBy] || 'last_activity_at';

    const sql = `
      SELECT * FROM projects ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder.toUpperCase()} NULLS LAST
      ${query.limit ? `LIMIT ${query.limit}` : ''}
      ${query.offset ? `OFFSET ${query.offset}` : ''}
    `;

    const rows = this.db.unsafe(sql);
    return (rows as any[]).map(row => this.rowToProject(row));
  }

  archiveProject(id: string): boolean {
    this.db`UPDATE projects SET status = 'archived', updated_at = NOW() WHERE id = ${id}`;
    return true;
  }

  private rowToProject(row: any): Project {
    return {
      id: row.id,
      displayName: row.display_name,
      description: row.description,
      gitRemoteUrl: row.git_remote_url,
      localPath: row.local_path,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      lastSessionId: row.last_session_id,
      lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at).getTime() : undefined,
      status: row.status,
      metadata: row.metadata || undefined
    };
  }

  // ============================================
  // Session Operations
  // ============================================

  getSession(id: string): ProjectSession | null {
    const rows = this.db`SELECT * FROM project_sessions WHERE id = ${id}`;
    const row = (rows as any[])[0];
    return row ? this.rowToSession(row) : null;
  }

  insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): ProjectSession {
    this.db`
      INSERT INTO project_sessions (
        id, project_id, started_at, ended_at, status, model_name,
        event_count, tool_call_count, notes
      ) VALUES (
        ${session.id},
        ${session.projectId},
        to_timestamp(${session.startedAt / 1000}),
        ${session.endedAt ? new Date(session.endedAt).toISOString() : null}::timestamptz,
        ${session.status || 'active'},
        ${session.modelName || null},
        0,
        0,
        ${session.notes || null}
      )
    `;

    return {
      ...session,
      eventCount: 0,
      toolCallCount: 0
    };
  }

  updateSession(id: string, updates: Partial<ProjectSession>): ProjectSession | null {
    const validStatuses = ['active', 'completed', 'abandoned'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      throw new Error(`Invalid session status: ${updates.status}`);
    }

    const session = this.getSession(id);
    if (!session) return null;

    const updatedSession = { ...session, ...updates };

    this.db`
      UPDATE project_sessions SET
        ended_at = ${updatedSession.endedAt ? new Date(updatedSession.endedAt).toISOString() : null}::timestamptz,
        status = ${updatedSession.status},
        model_name = ${updatedSession.modelName || null},
        event_count = ${updatedSession.eventCount},
        tool_call_count = ${updatedSession.toolCallCount},
        notes = ${updatedSession.notes || null}
      WHERE id = ${id}
    `;

    return updatedSession;
  }

  listProjectSessions(projectId: string): ProjectSession[] {
    const rows = this.db`
      SELECT * FROM project_sessions
      WHERE project_id = ${projectId}
      ORDER BY started_at DESC
    `;

    return (rows as any[]).map(row => this.rowToSession(row));
  }

  incrementSessionCounts(sessionId: string, events: number = 1, toolCalls: number = 0): void {
    this.db`
      UPDATE project_sessions
      SET event_count = event_count + ${events}, tool_call_count = tool_call_count + ${toolCalls}
      WHERE id = ${sessionId}
    `;
  }

  private rowToSession(row: any): ProjectSession {
    return {
      id: row.id,
      projectId: row.project_id,
      startedAt: new Date(row.started_at).getTime(),
      endedAt: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
      status: row.status,
      modelName: row.model_name,
      eventCount: row.event_count,
      toolCallCount: row.tool_call_count,
      notes: row.notes
    };
  }

  // ============================================
  // Auto-Registration Helpers
  // ============================================

  private parseDisplayName(projectId: string): string {
    if (projectId.startsWith('local:')) {
      const rest = projectId.slice(6);
      const dashIndex = rest.lastIndexOf('-');
      return dashIndex > 0 ? rest.slice(0, dashIndex) : rest;
    }
    return projectId.split(':').pop() || projectId;
  }

  ensureProjectExists(sourceApp: string): Project {
    let project = this.getProject(sourceApp);

    if (!project) {
      project = this.insertProject({
        id: sourceApp,
        displayName: this.parseDisplayName(sourceApp),
        status: 'active'
      });
    }

    return project;
  }

  ensureSessionExists(projectId: string, sessionId: string, modelName?: string): ProjectSession {
    let session = this.getSession(sessionId);

    if (!session) {
      session = this.insertSession({
        id: sessionId,
        projectId,
        startedAt: Date.now(),
        status: 'active',
        modelName
      });
    } else if (modelName && !session.modelName) {
      session = this.updateSession(sessionId, { modelName }) || session;
    }

    return session;
  }

  updateProjectActivity(projectId: string, sessionId: string): void {
    this.db`
      UPDATE projects
      SET last_session_id = ${sessionId}, last_activity_at = NOW(), updated_at = NOW()
      WHERE id = ${projectId}
    `;
  }
}
