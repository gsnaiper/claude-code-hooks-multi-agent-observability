/**
 * SQLite Database Adapter
 *
 * Implementation of DatabaseAdapter using Bun's native SQLite driver.
 * This is the default/fallback database when DATABASE_URL is not set.
 */

import { Database } from 'bun:sqlite';
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

export class SqliteAdapter implements DatabaseAdapter {
  private db!: Database;

  constructor(private dbPath: string = 'events.db') {}

  // ============================================
  // Lifecycle
  // ============================================

  init(): void {
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent performance
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');

    this.createTables();
    this.runMigrations();
  }

  close(): void {
    this.db.close();
  }

  private createTables(): void {
    // Events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_app TEXT NOT NULL,
        session_id TEXT NOT NULL,
        hook_event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        chat TEXT,
        summary TEXT,
        timestamp INTEGER NOT NULL,
        humanInTheLoop TEXT,
        humanInTheLoopStatus TEXT,
        model_name TEXT,
        project_id TEXT
      )
    `);

    // Event indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_source_app ON events(source_app)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_id ON events(session_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_hook_event_type ON events(hook_event_type)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id)');

    // Themes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS themes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        displayName TEXT NOT NULL,
        description TEXT,
        colors TEXT NOT NULL,
        isPublic INTEGER NOT NULL DEFAULT 0,
        authorId TEXT,
        authorName TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        tags TEXT,
        downloadCount INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        ratingCount INTEGER DEFAULT 0
      )
    `);

    // Theme shares table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS theme_shares (
        id TEXT PRIMARY KEY,
        themeId TEXT NOT NULL,
        shareToken TEXT NOT NULL UNIQUE,
        expiresAt INTEGER,
        isPublic INTEGER NOT NULL DEFAULT 0,
        allowedUsers TEXT,
        createdAt INTEGER NOT NULL,
        accessCount INTEGER DEFAULT 0,
        FOREIGN KEY (themeId) REFERENCES themes (id) ON DELETE CASCADE
      )
    `);

    // Theme ratings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS theme_ratings (
        id TEXT PRIMARY KEY,
        themeId TEXT NOT NULL,
        userId TEXT NOT NULL,
        rating INTEGER NOT NULL,
        comment TEXT,
        createdAt INTEGER NOT NULL,
        UNIQUE(themeId, userId),
        FOREIGN KEY (themeId) REFERENCES themes (id) ON DELETE CASCADE
      )
    `);

    // Theme indexes
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_themes_name ON themes(name)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_themes_isPublic ON themes(isPublic)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_themes_createdAt ON themes(createdAt)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_theme_shares_token ON theme_shares(shareToken)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_theme_ratings_theme ON theme_ratings(themeId)');

    // Audio cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audio_cache (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        audio_data TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
        voice_id TEXT,
        text_hash TEXT,
        source_app TEXT,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 1,
        size_bytes INTEGER
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audio_cache_key ON audio_cache(key)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audio_cache_source_app ON audio_cache(source_app)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_audio_cache_created_at ON audio_cache(created_at)');

    // Projects table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        description TEXT,
        git_remote_url TEXT,
        local_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_session_id TEXT,
        last_activity_at INTEGER,
        status TEXT DEFAULT 'active',
        metadata TEXT
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_projects_last_activity ON projects(last_activity_at DESC)');

    // Project sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT DEFAULT 'active',
        model_name TEXT,
        event_count INTEGER DEFAULT 0,
        tool_call_count INTEGER DEFAULT 0,
        notes TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_project ON project_sessions(project_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_started ON project_sessions(started_at DESC)');
  }

  private runMigrations(): void {
    // Migration: add missing columns to events table
    try {
      const columns = this.db.prepare("PRAGMA table_info(events)").all() as any[];
      const columnNames = columns.map((col: any) => col.name);

      const migrations = [
        { column: 'chat', type: 'TEXT' },
        { column: 'summary', type: 'TEXT' },
        { column: 'humanInTheLoop', type: 'TEXT' },
        { column: 'humanInTheLoopStatus', type: 'TEXT' },
        { column: 'model_name', type: 'TEXT' },
        { column: 'project_id', type: 'TEXT' }
      ];

      for (const { column, type } of migrations) {
        if (!columnNames.includes(column)) {
          this.db.exec(`ALTER TABLE events ADD COLUMN ${column} ${type}`);
        }
      }
    } catch {
      // Ignore migration errors
    }
  }

  // ============================================
  // Event Operations
  // ============================================

  insertEvent(event: HookEvent): HookEvent {
    const stmt = this.db.prepare(`
      INSERT INTO events (source_app, session_id, hook_event_type, payload, chat, summary, timestamp, humanInTheLoop, humanInTheLoopStatus, model_name, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const timestamp = event.timestamp || Date.now();

    // Initialize humanInTheLoopStatus to pending if humanInTheLoop exists
    let humanInTheLoopStatus = event.humanInTheLoopStatus;
    if (event.humanInTheLoop && !humanInTheLoopStatus) {
      humanInTheLoopStatus = { status: 'pending' };
    }

    const result = stmt.run(
      event.source_app,
      event.session_id,
      event.hook_event_type,
      JSON.stringify(event.payload),
      event.chat ? JSON.stringify(event.chat) : null,
      event.summary || null,
      timestamp,
      event.humanInTheLoop ? JSON.stringify(event.humanInTheLoop) : null,
      humanInTheLoopStatus ? JSON.stringify(humanInTheLoopStatus) : null,
      event.model_name || null,
      event.project_id || null
    );

    return {
      ...event,
      id: result.lastInsertRowid as number,
      timestamp,
      humanInTheLoopStatus,
      project_id: event.project_id
    };
  }

  getRecentEvents(limit: number = 300): HookEvent[] {
    const stmt = this.db.prepare(`
      SELECT id, source_app, session_id, hook_event_type, payload, chat, summary, timestamp, humanInTheLoop, humanInTheLoopStatus, model_name, project_id
      FROM events
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => this.rowToEvent(row)).reverse();
  }

  getEventsBySessionId(sessionId: string): HookEvent[] {
    const stmt = this.db.prepare(`
      SELECT id, source_app, session_id, hook_event_type, payload, chat, summary, timestamp, humanInTheLoop, humanInTheLoopStatus, model_name, project_id
      FROM events
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(sessionId) as any[];
    return rows.map(row => this.rowToEvent(row));
  }

  getFilterOptions(): FilterOptions {
    const sourceApps = this.db.prepare('SELECT DISTINCT source_app FROM events ORDER BY source_app').all() as { source_app: string }[];
    const sessionIds = this.db.prepare('SELECT DISTINCT session_id FROM events ORDER BY session_id DESC LIMIT 300').all() as { session_id: string }[];
    const hookEventTypes = this.db.prepare('SELECT DISTINCT hook_event_type FROM events ORDER BY hook_event_type').all() as { hook_event_type: string }[];

    return {
      source_apps: sourceApps.map(row => row.source_app),
      session_ids: sessionIds.map(row => row.session_id),
      hook_event_types: hookEventTypes.map(row => row.hook_event_type)
    };
  }

  updateEventHITLResponse(id: number, response: any): HookEvent | null {
    const status = {
      status: 'responded',
      respondedAt: response.respondedAt,
      response
    };

    this.db.prepare('UPDATE events SET humanInTheLoopStatus = ? WHERE id = ?')
      .run(JSON.stringify(status), id);

    const row = this.db.prepare(`
      SELECT id, source_app, session_id, hook_event_type, payload, chat, summary, timestamp, humanInTheLoop, humanInTheLoopStatus, model_name, project_id
      FROM events
      WHERE id = ?
    `).get(id) as any;

    return row ? this.rowToEvent(row) : null;
  }

  private rowToEvent(row: any): HookEvent {
    return {
      id: row.id,
      source_app: row.source_app,
      session_id: row.session_id,
      hook_event_type: row.hook_event_type,
      payload: JSON.parse(row.payload),
      chat: row.chat ? JSON.parse(row.chat) : undefined,
      summary: row.summary || undefined,
      timestamp: row.timestamp,
      humanInTheLoop: row.humanInTheLoop ? JSON.parse(row.humanInTheLoop) : undefined,
      humanInTheLoopStatus: row.humanInTheLoopStatus ? JSON.parse(row.humanInTheLoopStatus) : undefined,
      model_name: row.model_name || undefined,
      project_id: row.project_id || undefined
    };
  }

  // ============================================
  // Theme Operations
  // ============================================

  insertTheme(theme: Theme): Theme {
    const stmt = this.db.prepare(`
      INSERT INTO themes (id, name, displayName, description, colors, isPublic, authorId, authorName, createdAt, updatedAt, tags, downloadCount, rating, ratingCount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      theme.id,
      theme.name,
      theme.displayName,
      theme.description || null,
      JSON.stringify(theme.colors),
      theme.isPublic ? 1 : 0,
      theme.authorId || null,
      theme.authorName || null,
      theme.createdAt,
      theme.updatedAt,
      JSON.stringify(theme.tags),
      theme.downloadCount || 0,
      theme.rating || 0,
      theme.ratingCount || 0
    );

    return theme;
  }

  updateTheme(id: string, updates: Partial<Theme>): boolean {
    const allowedFields = ['displayName', 'description', 'colors', 'isPublic', 'updatedAt', 'tags'];
    const setClause = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .map(key => `${key} = ?`)
      .join(', ');

    if (!setClause) return false;

    const values = Object.keys(updates)
      .filter(key => allowedFields.includes(key))
      .map(key => {
        if (key === 'colors' || key === 'tags') {
          return JSON.stringify(updates[key as keyof Theme]);
        }
        if (key === 'isPublic') {
          return updates[key as keyof Theme] ? 1 : 0;
        }
        return updates[key as keyof Theme];
      });

    const stmt = this.db.prepare(`UPDATE themes SET ${setClause} WHERE id = ?`);
    const result = stmt.run(...values, id);

    return result.changes > 0;
  }

  getTheme(id: string): Theme | null {
    const row = this.db.prepare('SELECT * FROM themes WHERE id = ?').get(id) as any;
    return row ? this.rowToTheme(row) : null;
  }

  getThemes(query: ThemeSearchQuery = {}): Theme[] {
    let sql = 'SELECT * FROM themes WHERE 1=1';
    const params: any[] = [];

    if (query.isPublic !== undefined) {
      sql += ' AND isPublic = ?';
      params.push(query.isPublic ? 1 : 0);
    }

    if (query.authorId) {
      sql += ' AND authorId = ?';
      params.push(query.authorId);
    }

    if (query.query) {
      sql += ' AND (name LIKE ? OR displayName LIKE ? OR description LIKE ?)';
      const searchTerm = `%${query.query}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const sortBy = query.sortBy || 'created';
    const sortOrder = query.sortOrder || 'desc';
    const sortColumn = {
      name: 'name',
      created: 'createdAt',
      updated: 'updatedAt',
      downloads: 'downloadCount',
      rating: 'rating'
    }[sortBy] || 'createdAt';

    sql += ` ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}`;

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
      if (query.offset) {
        sql += ' OFFSET ?';
        params.push(query.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToTheme(row));
  }

  deleteTheme(id: string): boolean {
    const result = this.db.prepare('DELETE FROM themes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  incrementThemeDownloadCount(id: string): boolean {
    const result = this.db.prepare('UPDATE themes SET downloadCount = downloadCount + 1 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private rowToTheme(row: any): Theme {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      colors: JSON.parse(row.colors),
      isPublic: Boolean(row.isPublic),
      authorId: row.authorId,
      authorName: row.authorName,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tags: JSON.parse(row.tags || '[]'),
      downloadCount: row.downloadCount,
      rating: row.rating,
      ratingCount: row.ratingCount
    };
  }

  // ============================================
  // Audio Cache Operations
  // ============================================

  insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): AudioCacheEntry {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO audio_cache (id, key, audio_data, mime_type, voice_id, text_hash, source_app, created_at, accessed_at, access_count, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.key,
      entry.audioData,
      entry.mimeType || 'audio/mpeg',
      entry.voiceId || null,
      entry.textHash || null,
      entry.sourceApp || null,
      now,
      now,
      1,
      entry.sizeBytes || null
    );

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
    const row = this.db.prepare('SELECT * FROM audio_cache WHERE key = ?').get(key) as any;

    if (!row) return null;

    // Update access stats
    this.db.prepare('UPDATE audio_cache SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
      .run(Date.now(), row.id);

    return {
      id: row.id,
      key: row.key,
      audioData: row.audio_data,
      mimeType: row.mime_type,
      voiceId: row.voice_id,
      textHash: row.text_hash,
      sourceApp: row.source_app,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
      sizeBytes: row.size_bytes
    };
  }

  getAudioCacheStats(): { count: number; totalSize: number; keys: string[] } {
    const countResult = this.db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as total FROM audio_cache').get() as any;
    const keysResult = this.db.prepare('SELECT key FROM audio_cache ORDER BY accessed_at DESC LIMIT 100').all() as any[];

    return {
      count: countResult?.count || 0,
      totalSize: countResult?.total || 0,
      keys: keysResult.map(r => r.key)
    };
  }

  deleteOldAudioCache(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare('DELETE FROM audio_cache WHERE accessed_at < ?').run(cutoff);
    return result.changes;
  }

  // ============================================
  // Project Operations
  // ============================================

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? this.rowToProject(row) : null;
  }

  insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project {
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO projects (id, display_name, description, git_remote_url, local_path, created_at, updated_at, last_session_id, last_activity_at, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id,
      project.displayName || null,
      project.description || null,
      project.gitRemoteUrl || null,
      project.localPath || null,
      now,
      now,
      project.lastSessionId || null,
      project.lastActivityAt || null,
      project.status || 'active',
      project.metadata ? JSON.stringify(project.metadata) : null
    );

    return {
      ...project,
      createdAt: now,
      updatedAt: now
    };
  }

  updateProject(id: string, updates: Partial<Project>): Project | null {
    const now = Date.now();

    const validStatuses = ['active', 'archived', 'paused'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      throw new Error(`Invalid project status: ${updates.status}`);
    }

    const project = this.getProject(id);
    if (!project) return null;

    const updatedProject = { ...project, ...updates, updatedAt: now };

    this.db.prepare(`
      UPDATE projects SET
        display_name = ?,
        description = ?,
        git_remote_url = ?,
        local_path = ?,
        updated_at = ?,
        last_session_id = ?,
        last_activity_at = ?,
        status = ?,
        metadata = ?
      WHERE id = ?
    `).run(
      updatedProject.displayName || null,
      updatedProject.description || null,
      updatedProject.gitRemoteUrl || null,
      updatedProject.localPath || null,
      now,
      updatedProject.lastSessionId || null,
      updatedProject.lastActivityAt || null,
      updatedProject.status,
      updatedProject.metadata ? JSON.stringify(updatedProject.metadata) : null,
      id
    );

    return updatedProject;
  }

  listProjects(query: ProjectSearchQuery = {}): Project[] {
    let sql = 'SELECT * FROM projects WHERE 1=1';
    const params: any[] = [];

    if (query.status) {
      sql += ' AND status = ?';
      params.push(query.status);
    }

    if (query.query) {
      sql += ' AND (id LIKE ? OR display_name LIKE ? OR description LIKE ?)';
      const searchTerm = `%${query.query}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const sortBy = query.sortBy || 'lastActivity';
    const sortOrder = query.sortOrder || 'desc';
    const sortColumn = {
      name: 'display_name',
      created: 'created_at',
      updated: 'updated_at',
      lastActivity: 'last_activity_at'
    }[sortBy] || 'last_activity_at';

    // Put NULLs at end
    const sortDir = sortOrder.toUpperCase();
    sql += ` ORDER BY CASE WHEN ${sortColumn} IS NULL THEN 1 ELSE 0 END, ${sortColumn} ${sortDir}`;

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
      if (query.offset) {
        sql += ' OFFSET ?';
        params.push(query.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToProject(row));
  }

  archiveProject(id: string): boolean {
    const result = this.db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?')
      .run('archived', Date.now(), id);
    return result.changes > 0;
  }

  private rowToProject(row: any): Project {
    return {
      id: row.id,
      displayName: row.display_name,
      description: row.description,
      gitRemoteUrl: row.git_remote_url,
      localPath: row.local_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSessionId: row.last_session_id,
      lastActivityAt: row.last_activity_at,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }

  // ============================================
  // Session Operations
  // ============================================

  getSession(id: string): ProjectSession | null {
    const row = this.db.prepare('SELECT * FROM project_sessions WHERE id = ?').get(id) as any;
    return row ? this.rowToSession(row) : null;
  }

  insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): ProjectSession {
    this.db.prepare(`
      INSERT INTO project_sessions (id, project_id, started_at, ended_at, status, model_name, event_count, tool_call_count, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.projectId,
      session.startedAt,
      session.endedAt || null,
      session.status || 'active',
      session.modelName || null,
      0,
      0,
      session.notes || null
    );

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

    this.db.prepare(`
      UPDATE project_sessions SET
        ended_at = ?,
        status = ?,
        model_name = ?,
        event_count = ?,
        tool_call_count = ?,
        notes = ?
      WHERE id = ?
    `).run(
      updatedSession.endedAt || null,
      updatedSession.status,
      updatedSession.modelName || null,
      updatedSession.eventCount,
      updatedSession.toolCallCount,
      updatedSession.notes || null,
      id
    );

    return updatedSession;
  }

  listProjectSessions(projectId: string): ProjectSession[] {
    const rows = this.db.prepare('SELECT * FROM project_sessions WHERE project_id = ? ORDER BY started_at DESC')
      .all(projectId) as any[];
    return rows.map(row => this.rowToSession(row));
  }

  incrementSessionCounts(sessionId: string, events: number = 1, toolCalls: number = 0): void {
    this.db.prepare(`
      UPDATE project_sessions
      SET event_count = event_count + ?, tool_call_count = tool_call_count + ?
      WHERE id = ?
    `).run(events, toolCalls, sessionId);
  }

  private rowToSession(row: any): ProjectSession {
    return {
      id: row.id,
      projectId: row.project_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
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
    // group:project → project
    // local:dirname-hash → dirname
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
    const now = Date.now();
    this.db.prepare(`
      UPDATE projects SET last_session_id = ?, last_activity_at = ?, updated_at = ?
      WHERE id = ?
    `).run(sessionId, now, now, projectId);
  }
}
