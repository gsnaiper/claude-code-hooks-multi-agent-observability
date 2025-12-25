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

import { SQL } from 'bun';
import type { DatabaseAdapter, AudioCacheEntry } from './adapter';
import type {
  HookEvent,
  FilterOptions,
  Theme,
  ThemeSearchQuery,
  Project,
  ProjectSession,
  ProjectSearchQuery,
  ProjectSetting,
  ProjectSettingInput,
  SettingType,
  Repository,
  RepositoryInput,
  SessionSetting,
  SessionSettingInput
} from '../types';

export class PostgresAdapter implements DatabaseAdapter {
  private db!: SQL;

  constructor(private connectionString: string) {}

  // ============================================
  // Lifecycle
  // ============================================

  async init(): Promise<void> {
    // Bun.sql creates a connection pool automatically
    this.db = new SQL(this.connectionString);
    console.log('[Postgres] Connected to database');
  }

  async close(): Promise<void> {
    // Bun.sql handles connection cleanup automatically
    if (this.db) {
      this.db.close();
    }
    console.log('[Postgres] Connection closed');
  }

  // ============================================
  // Event Operations
  // ============================================

  async insertEvent(event: HookEvent): Promise<HookEvent> {
    const timestamp = event.timestamp || Date.now();

    // Initialize humanInTheLoopStatus to pending if humanInTheLoop exists
    let humanInTheLoopStatus = event.humanInTheLoopStatus;
    if (event.humanInTheLoop && !humanInTheLoopStatus) {
      humanInTheLoopStatus = { status: 'pending' };
    }

    const result = await this.db`
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

  async getRecentEvents(limit: number = 300): Promise<HookEvent[]> {
    const rows = await this.db`
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

  async getEventsBySessionId(sessionId: string): Promise<HookEvent[]> {
    const rows = await this.db`
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

  async getFilterOptions(): Promise<FilterOptions> {
    const sourceApps = await this.db`SELECT DISTINCT source_app FROM events ORDER BY source_app`;
    const sessionIds = await this.db`SELECT DISTINCT session_id FROM events ORDER BY session_id DESC LIMIT 300`;
    const hookEventTypes = await this.db`SELECT DISTINCT hook_event_type FROM events ORDER BY hook_event_type`;

    return {
      source_apps: (sourceApps as any[]).map(row => row.source_app),
      session_ids: (sessionIds as any[]).map(row => row.session_id),
      hook_event_types: (hookEventTypes as any[]).map(row => row.hook_event_type)
    };
  }

  async updateEventHITLResponse(id: number, response: any): Promise<HookEvent | null> {
    const status = {
      status: 'responded',
      respondedAt: response.respondedAt,
      response
    };

    await this.db`
      UPDATE events
      SET human_in_the_loop_status = ${JSON.stringify(status)}::jsonb
      WHERE id = ${id}
    `;

    const rows = await this.db`
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
    // Parse JSONB if returned as string (bun:sql behavior)
    const parseJsonb = (val: any) => {
      if (!val) return undefined;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    return {
      id: Number(row.id),
      source_app: row.source_app,
      session_id: row.session_id,
      hook_event_type: row.hook_event_type,
      payload: parseJsonb(row.payload),
      chat: parseJsonb(row.chat),
      summary: row.summary || undefined,
      timestamp: Math.floor(Number(row.timestamp)),
      humanInTheLoop: parseJsonb(row.human_in_the_loop),
      humanInTheLoopStatus: parseJsonb(row.human_in_the_loop_status),
      model_name: row.model_name || undefined,
      project_id: row.project_id || undefined
    };
  }

  // ============================================
  // Theme Operations
  // ============================================

  async insertTheme(theme: Theme): Promise<Theme> {
    await this.db`
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

  async updateTheme(id: string, updates: Partial<Theme>): Promise<boolean> {
    await this.db`
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

  async getTheme(id: string): Promise<Theme | null> {
    const rows = await this.db`SELECT * FROM themes WHERE id = ${id}`;
    const row = (rows as any[])[0];
    return row ? this.rowToTheme(row) : null;
  }

  async getThemes(query: ThemeSearchQuery = {}): Promise<Theme[]> {
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
    const sqlQuery = `
      SELECT * FROM themes ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}
      ${query.limit ? `LIMIT ${query.limit}` : ''}
      ${query.offset ? `OFFSET ${query.offset}` : ''}
    `;

    const rows = await this.db.unsafe(sqlQuery);
    return (rows as any[]).map(row => this.rowToTheme(row));
  }

  async deleteTheme(id: string): Promise<boolean> {
    await this.db`DELETE FROM themes WHERE id = ${id}`;
    return true;
  }

  async incrementThemeDownloadCount(id: string): Promise<boolean> {
    await this.db`UPDATE themes SET download_count = download_count + 1 WHERE id = ${id}`;
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

  async insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): Promise<AudioCacheEntry> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await this.db`
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

  async getAudioCacheByKey(key: string): Promise<AudioCacheEntry | null> {
    const rows = await this.db`SELECT * FROM audio_cache WHERE key = ${key}`;
    const row = (rows as any[])[0];

    if (!row) return null;

    // Update access stats
    await this.db`UPDATE audio_cache SET accessed_at = NOW(), access_count = access_count + 1 WHERE id = ${row.id}`;

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

  async getAudioCacheStats(): Promise<{ count: number; totalSize: number; keys: string[] }> {
    const countResult = await this.db`SELECT COUNT(*) as count, COALESCE(SUM(size_bytes), 0) as total FROM audio_cache`;
    const keysResult = await this.db`SELECT key FROM audio_cache ORDER BY accessed_at DESC LIMIT 100`;

    const stats = (countResult as any[])[0];
    return {
      count: Number(stats?.count) || 0,
      totalSize: Number(stats?.total) || 0,
      keys: (keysResult as any[]).map(r => r.key)
    };
  }

  async deleteOldAudioCache(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();
    await this.db`DELETE FROM audio_cache WHERE accessed_at < ${cutoffDate}::timestamptz`;
    return 0; // Bun.sql doesn't return affected rows easily
  }

  // ============================================
  // Project Operations
  // ============================================

  async getProject(id: string): Promise<Project | null> {
    const rows = await this.db`SELECT * FROM projects WHERE id = ${id}`;
    const row = (rows as any[])[0];
    return row ? this.rowToProject(row) : null;
  }

  async insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> {
    const now = Date.now();

    await this.db`
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

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
    const validStatuses = ['active', 'archived', 'paused'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      throw new Error(`Invalid project status: ${updates.status}`);
    }

    const project = await this.getProject(id);
    if (!project) return null;

    const now = Date.now();
    const updatedProject = { ...project, ...updates, updatedAt: now };

    await this.db`
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

  async listProjects(query: ProjectSearchQuery = {}): Promise<Project[]> {
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

    const sqlQuery = `
      SELECT * FROM projects ${whereClause}
      ORDER BY ${sortColumn} ${sortOrder.toUpperCase()} NULLS LAST
      ${query.limit ? `LIMIT ${query.limit}` : ''}
      ${query.offset ? `OFFSET ${query.offset}` : ''}
    `;

    const rows = await this.db.unsafe(sqlQuery);
    return (rows as any[]).map(row => this.rowToProject(row));
  }

  async archiveProject(id: string): Promise<boolean> {
    await this.db`UPDATE projects SET status = 'archived', updated_at = NOW() WHERE id = ${id}`;
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

  async getSession(id: string): Promise<ProjectSession | null> {
    const rows = await this.db`SELECT * FROM project_sessions WHERE id = ${id}`;
    const row = (rows as any[])[0];
    return row ? this.rowToSession(row) : null;
  }

  async insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): Promise<ProjectSession> {
    await this.db`
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

  async updateSession(id: string, updates: Partial<ProjectSession>): Promise<ProjectSession | null> {
    const validStatuses = ['active', 'completed', 'abandoned'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      throw new Error(`Invalid session status: ${updates.status}`);
    }

    const session = await this.getSession(id);
    if (!session) return null;

    const updatedSession = { ...session, ...updates };

    await this.db`
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

  async listProjectSessions(projectId: string): Promise<ProjectSession[]> {
    const rows = await this.db`
      SELECT * FROM project_sessions
      WHERE project_id = ${projectId}
      ORDER BY started_at DESC
    `;

    return (rows as any[]).map(row => this.rowToSession(row));
  }

  async incrementSessionCounts(sessionId: string, events: number = 1, toolCalls: number = 0): Promise<void> {
    await this.db`
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

  async ensureProjectExists(sourceApp: string): Promise<Project> {
    let project = await this.getProject(sourceApp);

    if (!project) {
      project = await this.insertProject({
        id: sourceApp,
        displayName: this.parseDisplayName(sourceApp),
        status: 'active'
      });
    }

    return project;
  }

  async ensureSessionExists(projectId: string, sessionId: string, modelName?: string): Promise<ProjectSession> {
    let session = await this.getSession(sessionId);

    if (!session) {
      session = await this.insertSession({
        id: sessionId,
        projectId,
        startedAt: Date.now(),
        status: 'active',
        modelName
      });
    } else if (modelName && !session.modelName) {
      session = await this.updateSession(sessionId, { modelName }) || session;
    }

    return session;
  }

  async updateProjectActivity(projectId: string, sessionId: string): Promise<void> {
    await this.db`
      UPDATE projects
      SET last_session_id = ${sessionId}, last_activity_at = NOW(), updated_at = NOW()
      WHERE id = ${projectId}
    `;
  }

  // ============================================
  // Project Settings Operations
  // ============================================

  async getProjectSettings(projectId: string, type?: SettingType): Promise<ProjectSetting[]> {
    let rows;
    if (type) {
      rows = await this.db`
        SELECT * FROM project_settings
        WHERE project_id = ${projectId} AND setting_type = ${type}
        ORDER BY setting_key ASC
      `;
    } else {
      rows = await this.db`
        SELECT * FROM project_settings
        WHERE project_id = ${projectId}
        ORDER BY setting_key ASC
      `;
    }

    return (rows as any[]).map(row => this.rowToProjectSetting(row));
  }

  async getProjectSetting(projectId: string, type: SettingType, key: string): Promise<ProjectSetting | null> {
    const rows = await this.db`
      SELECT * FROM project_settings
      WHERE project_id = ${projectId} AND setting_type = ${type} AND setting_key = ${key}
    `;

    const row = (rows as any[])[0];
    return row ? this.rowToProjectSetting(row) : null;
  }

  async insertProjectSetting(projectId: string, type: SettingType, input: ProjectSettingInput): Promise<ProjectSetting> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await this.db`
      INSERT INTO project_settings (id, project_id, setting_type, setting_key, setting_value, enabled, created_at, updated_at)
      VALUES (
        ${id},
        ${projectId},
        ${type},
        ${input.settingKey},
        ${JSON.stringify(input.settingValue)}::jsonb,
        ${input.enabled !== false},
        NOW(),
        NOW()
      )
    `;

    return {
      id,
      projectId,
      settingType: type,
      settingKey: input.settingKey,
      settingValue: input.settingValue,
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now
    };
  }

  async updateProjectSetting(id: string, updates: Partial<ProjectSettingInput>): Promise<ProjectSetting | null> {
    const rows = await this.db`SELECT * FROM project_settings WHERE id = ${id}`;
    const row = (rows as any[])[0];
    if (!row) return null;

    const now = Date.now();
    const current = this.rowToProjectSetting(row);

    const updated = {
      ...current,
      settingValue: updates.settingValue ?? current.settingValue,
      enabled: updates.enabled ?? current.enabled,
      updatedAt: now
    };

    await this.db`
      UPDATE project_settings
      SET setting_value = ${JSON.stringify(updated.settingValue)}::jsonb,
          enabled = ${updated.enabled},
          updated_at = NOW()
      WHERE id = ${id}
    `;

    return updated;
  }

  async deleteProjectSetting(id: string): Promise<boolean> {
    await this.db`DELETE FROM project_settings WHERE id = ${id}`;
    return true;
  }

  async bulkUpsertProjectSettings(projectId: string, type: SettingType, settings: ProjectSettingInput[]): Promise<ProjectSetting[]> {
    const results: ProjectSetting[] = [];

    for (const input of settings) {
      const existing = await this.getProjectSetting(projectId, type, input.settingKey);

      if (existing) {
        const updated = await this.updateProjectSetting(existing.id, input);
        if (updated) results.push(updated);
      } else {
        const inserted = await this.insertProjectSetting(projectId, type, input);
        results.push(inserted);
      }
    }

    return results;
  }

  private rowToProjectSetting(row: any): ProjectSetting {
    const parseJsonb = (val: any) => {
      if (!val) return {};
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return val; }
      }
      return val;
    };

    return {
      id: row.id,
      projectId: row.project_id,
      settingType: row.setting_type as SettingType,
      settingKey: row.setting_key,
      settingValue: parseJsonb(row.setting_value),
      enabled: Boolean(row.enabled),
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime()
    };
  }

  // ============================================
  // Session Reassignment
  // ============================================

  async reassignSession(sessionId: string, newProjectId: string): Promise<{ session: ProjectSession; movedEvents: number }> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const oldProjectId = session.projectId;
    if (oldProjectId === newProjectId) {
      return { session, movedEvents: 0 };
    }

    // Ensure new project exists
    await this.ensureProjectExists(newProjectId);

    // Get event counts before move
    const countResult = await this.db`SELECT COUNT(*) as count FROM events WHERE session_id = ${sessionId}`;
    const eventCount = Number((countResult as any[])[0]?.count) || 0;

    // Move all events to new project
    await this.db`UPDATE events SET project_id = ${newProjectId} WHERE session_id = ${sessionId}`;

    // Update session's project
    await this.db`UPDATE project_sessions SET project_id = ${newProjectId} WHERE id = ${sessionId}`;

    // Update new project activity
    await this.updateProjectActivity(newProjectId, sessionId);

    // Return updated session
    const updatedSession = await this.getSession(sessionId);
    return {
      session: updatedSession!,
      movedEvents: eventCount
    };
  }

  async backfillSessionMetadata(): Promise<{ updated: number; skipped: number }> {
    // TODO: Implement for Postgres
    console.warn('[PostgresAdapter] backfillSessionMetadata not implemented');
    return { updated: 0, skipped: 0 };
  }

  // ============================================
  // Repository Operations (Stubs)
  // ============================================

  async getProjectRepositories(projectId: string): Promise<Repository[]> {
    console.warn('[PostgresAdapter] getProjectRepositories not implemented');
    return [];
  }

  async getRepository(id: string): Promise<Repository | null> {
    console.warn('[PostgresAdapter] getRepository not implemented');
    return null;
  }

  async insertRepository(projectId: string, input: RepositoryInput): Promise<Repository> {
    throw new Error('[PostgresAdapter] insertRepository not implemented');
  }

  async updateRepository(id: string, updates: Partial<RepositoryInput>): Promise<Repository | null> {
    console.warn('[PostgresAdapter] updateRepository not implemented');
    return null;
  }

  async deleteRepository(id: string): Promise<boolean> {
    console.warn('[PostgresAdapter] deleteRepository not implemented');
    return false;
  }

  async setPrimaryRepository(projectId: string, repoId: string): Promise<boolean> {
    console.warn('[PostgresAdapter] setPrimaryRepository not implemented');
    return false;
  }

  // ============================================
  // Session Settings Operations (Stubs)
  // ============================================

  async getSessionSettings(sessionId: string, type?: SettingType): Promise<SessionSetting[]> {
    console.warn('[PostgresAdapter] getSessionSettings not implemented');
    return [];
  }

  async getSessionSetting(sessionId: string, type: SettingType, key: string): Promise<SessionSetting | null> {
    console.warn('[PostgresAdapter] getSessionSetting not implemented');
    return null;
  }

  async insertSessionSetting(sessionId: string, type: SettingType, input: SessionSettingInput): Promise<SessionSetting> {
    throw new Error('[PostgresAdapter] insertSessionSetting not implemented');
  }

  async updateSessionSetting(id: string, updates: Partial<SessionSettingInput>): Promise<SessionSetting | null> {
    console.warn('[PostgresAdapter] updateSessionSetting not implemented');
    return null;
  }

  async deleteSessionSetting(id: string): Promise<boolean> {
    console.warn('[PostgresAdapter] deleteSessionSetting not implemented');
    return false;
  }

  async bulkUpsertSessionSettings(sessionId: string, type: SettingType, settings: SessionSettingInput[]): Promise<SessionSetting[]> {
    console.warn('[PostgresAdapter] bulkUpsertSessionSettings not implemented');
    return [];
  }

  async getEffectiveSettings(sessionId: string, type?: SettingType): Promise<ProjectSetting[]> {
    // For now, just return project settings without session override merging
    const session = await this.getSession(sessionId);
    if (!session) return [];
    return this.getProjectSettings(session.projectId, type);
  }

  // ============================================
  // Orphaned Sessions Operations (Stubs)
  // ============================================

  async getUnassignedSessions(): Promise<ProjectSession[]> {
    console.warn('[PostgresAdapter] getUnassignedSessions not implemented');
    return [];
  }

  async assignSessionToProject(sessionId: string, projectId: string): Promise<ProjectSession | null> {
    const result = await this.reassignSession(sessionId, projectId);
    return result.session;
  }
}
