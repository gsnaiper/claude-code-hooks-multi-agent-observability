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
  EventSummary,
  EventFilters,
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
  SessionSettingInput,
  OverrideMode
} from '../types';

export class SqliteAdapter implements DatabaseAdapter {
  private db!: Database;

  constructor(private dbPath: string = 'events.db') {}

  // ============================================
  // Lifecycle
  // ============================================

  async init(): Promise<void> {
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent performance
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');

    this.createTables();
    this.runMigrations();
  }

  async close(): Promise<void> {
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

    // Project settings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_settings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        setting_type TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(project_id, setting_type, setting_key),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_project_settings_project ON project_settings(project_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_project_settings_type ON project_settings(project_id, setting_type)');

    // Project repositories table (multi-repo support)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_repositories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        git_remote_url TEXT,
        local_path TEXT,
        git_branch TEXT,
        is_primary INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(project_id, git_remote_url),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_project_repos_project ON project_repositories(project_id)');

    // Session settings table (inheritance from project)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_settings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        setting_type TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value TEXT NOT NULL,
        override_mode TEXT NOT NULL DEFAULT 'replace',
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, setting_type, setting_key),
        FOREIGN KEY (session_id) REFERENCES project_sessions(id) ON DELETE CASCADE
      )
    `);

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_settings_session ON session_settings(session_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_settings_type ON session_settings(session_id, setting_type)');
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

    // Migration: add session metadata columns to project_sessions table
    try {
      const sessionColumns = this.db.prepare("PRAGMA table_info(project_sessions)").all() as any[];
      const sessionColumnNames = sessionColumns.map((col: any) => col.name);

      const sessionMigrations = [
        { column: 'cwd', type: 'TEXT' },
        { column: 'transcript_path', type: 'TEXT' },
        { column: 'permission_mode', type: 'TEXT' },
        { column: 'initial_prompt', type: 'TEXT' },
        { column: 'session_summary', type: 'TEXT' },
        { column: 'git_branch', type: 'TEXT' }
      ];

      for (const { column, type } of sessionMigrations) {
        if (!sessionColumnNames.includes(column)) {
          this.db.exec(`ALTER TABLE project_sessions ADD COLUMN ${column} ${type}`);
        }
      }
    } catch {
      // Ignore migration errors
    }

    // Migration: add is_manual column to projects table
    try {
      const projectColumns = this.db.prepare("PRAGMA table_info(projects)").all() as any[];
      const projectColumnNames = projectColumns.map((col: any) => col.name);

      if (!projectColumnNames.includes('is_manual')) {
        this.db.exec(`ALTER TABLE projects ADD COLUMN is_manual INTEGER DEFAULT 0`);
      }
    } catch {
      // Ignore migration errors
    }
  }

  // ============================================
  // Event Operations
  // ============================================

  async insertEvent(event: HookEvent): Promise<HookEvent> {
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

  async getRecentEvents(limit: number = 300): Promise<HookEvent[]> {
    const stmt = this.db.prepare(`
      SELECT id, source_app, session_id, hook_event_type, payload, chat, summary, timestamp, humanInTheLoop, humanInTheLoopStatus, model_name, project_id
      FROM events
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => this.rowToEvent(row)).reverse();
  }

  async getEventsBySessionId(sessionId: string): Promise<HookEvent[]> {
    const stmt = this.db.prepare(`
      SELECT id, source_app, session_id, hook_event_type, payload, chat, summary, timestamp, humanInTheLoop, humanInTheLoopStatus, model_name, project_id
      FROM events
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(sessionId) as any[];
    return rows.map(row => this.rowToEvent(row));
  }

  async getFilterOptions(): Promise<FilterOptions> {
    const sourceApps = this.db.prepare('SELECT DISTINCT source_app FROM events ORDER BY source_app').all() as { source_app: string }[];
    const sessionIds = this.db.prepare('SELECT DISTINCT session_id FROM events ORDER BY session_id DESC LIMIT 300').all() as { session_id: string }[];
    const hookEventTypes = this.db.prepare('SELECT DISTINCT hook_event_type FROM events ORDER BY hook_event_type').all() as { hook_event_type: string }[];

    return {
      source_apps: sourceApps.map(row => row.source_app),
      session_ids: sessionIds.map(row => row.session_id),
      hook_event_types: hookEventTypes.map(row => row.hook_event_type)
    };
  }

  async updateEventHITLResponse(id: number, response: any): Promise<HookEvent | null> {
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

  async getEventSummaries(filters?: EventFilters): Promise<EventSummary[]> {
    const limit = filters?.limit ?? 300;
    const offset = filters?.offset ?? 0;

    // Build time range conditions
    let fromTs: number | null = null;
    let toTs: number | null = null;

    if (filters?.from) {
      fromTs = filters.from;
    } else if (filters?.timeRange && filters.timeRange !== 'all' && filters.timeRange !== 'live') {
      const now = Date.now();
      const ranges: Record<string, number> = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
      };
      fromTs = now - (ranges[filters.timeRange] || 0);
    }

    if (filters?.to) {
      toTs = filters.to;
    }

    // Build WHERE conditions dynamically
    const conditions: string[] = [];
    const params: any[] = [];

    if (fromTs !== null) {
      conditions.push('timestamp >= ?');
      params.push(fromTs);
    }
    if (toTs !== null) {
      conditions.push('timestamp <= ?');
      params.push(toTs);
    }
    if (filters?.source_app) {
      conditions.push('source_app = ?');
      params.push(filters.source_app);
    }
    if (filters?.session_id) {
      conditions.push('session_id = ?');
      params.push(filters.session_id);
    }
    if (filters?.hook_event_type) {
      conditions.push('hook_event_type = ?');
      params.push(filters.hook_event_type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        id,
        source_app,
        session_id,
        hook_event_type,
        timestamp,
        model_name,
        summary,
        project_id,
        json_extract(payload, '$.tool_name') as tool_name,
        json_extract(payload, '$.tool_input.command') as tool_command,
        json_extract(payload, '$.tool_input.file_path') as tool_file_path,
        CASE WHEN humanInTheLoop IS NOT NULL THEN 1 ELSE 0 END as has_hitl,
        json_extract(humanInTheLoop, '$.type') as hitl_type,
        CASE WHEN humanInTheLoopStatus IS NOT NULL THEN 'responded' ELSE 'pending' END as hitl_status
      FROM events
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map(row => ({
      id: row.id,
      source_app: row.source_app,
      session_id: row.session_id,
      hook_event_type: row.hook_event_type,
      timestamp: row.timestamp,
      model_name: row.model_name || undefined,
      summary: row.summary || undefined,
      project_id: row.project_id || undefined,
      tool_name: row.tool_name || undefined,
      tool_command: row.tool_command || undefined,
      tool_file_path: row.tool_file_path || undefined,
      has_hitl: row.has_hitl === 1,
      hitl_type: row.hitl_type || undefined,
      hitl_status: row.has_hitl === 1 ? (row.hitl_status as 'pending' | 'responded') : undefined
    })).reverse(); // Reverse to get chronological order (oldest first)
  }

  async getEventById(id: number): Promise<HookEvent | null> {
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

  async insertTheme(theme: Theme): Promise<Theme> {
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

  async updateTheme(id: string, updates: Partial<Theme>): Promise<boolean> {
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

  async getTheme(id: string): Promise<Theme | null> {
    const row = this.db.prepare('SELECT * FROM themes WHERE id = ?').get(id) as any;
    return row ? this.rowToTheme(row) : null;
  }

  async getThemes(query: ThemeSearchQuery = {}): Promise<Theme[]> {
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

  async deleteTheme(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM themes WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async incrementThemeDownloadCount(id: string): Promise<boolean> {
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

  async insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): Promise<AudioCacheEntry> {
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

  async getAudioCacheByKey(key: string): Promise<AudioCacheEntry | null> {
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

  async getAudioCacheStats(): Promise<{ count: number; totalSize: number; keys: string[] }> {
    const countResult = this.db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as total FROM audio_cache').get() as any;
    const keysResult = this.db.prepare('SELECT key FROM audio_cache ORDER BY accessed_at DESC LIMIT 100').all() as any[];

    return {
      count: countResult?.count || 0,
      totalSize: countResult?.total || 0,
      keys: keysResult.map(r => r.key)
    };
  }

  async deleteOldAudioCache(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare('DELETE FROM audio_cache WHERE accessed_at < ?').run(cutoff);
    return result.changes;
  }

  // ============================================
  // Project Operations
  // ============================================

  async getProject(id: string): Promise<Project | null> {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? this.rowToProject(row) : null;
  }

  async insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> {
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

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
    const now = Date.now();

    const validStatuses = ['active', 'archived', 'paused'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      throw new Error(`Invalid project status: ${updates.status}`);
    }

    const project = await this.getProject(id);
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

  async listProjects(query: ProjectSearchQuery = {}): Promise<Project[]> {
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

  async archiveProject(id: string): Promise<boolean> {
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
      isManual: Boolean(row.is_manual),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    };
  }

  // ============================================
  // Session Operations
  // ============================================

  async getSession(id: string): Promise<ProjectSession | null> {
    const row = this.db.prepare('SELECT * FROM project_sessions WHERE id = ?').get(id) as any;
    return row ? this.rowToSession(row) : null;
  }

  async insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): Promise<ProjectSession> {
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

  async updateSession(id: string, updates: Partial<ProjectSession>): Promise<ProjectSession | null> {
    const validStatuses = ['active', 'completed', 'abandoned'];
    if (updates.status && !validStatuses.includes(updates.status)) {
      throw new Error(`Invalid session status: ${updates.status}`);
    }

    const session = await this.getSession(id);
    if (!session) return null;

    const updatedSession = { ...session, ...updates };

    this.db.prepare(`
      UPDATE project_sessions SET
        ended_at = ?,
        status = ?,
        model_name = ?,
        event_count = ?,
        tool_call_count = ?,
        notes = ?,
        cwd = ?,
        transcript_path = ?,
        permission_mode = ?,
        initial_prompt = ?,
        session_summary = ?,
        git_branch = ?
      WHERE id = ?
    `).run(
      updatedSession.endedAt || null,
      updatedSession.status,
      updatedSession.modelName || null,
      updatedSession.eventCount,
      updatedSession.toolCallCount,
      updatedSession.notes || null,
      updatedSession.cwd || null,
      updatedSession.transcriptPath || null,
      updatedSession.permissionMode || null,
      updatedSession.initialPrompt || null,
      updatedSession.summary || null,
      updatedSession.gitBranch || null,
      id
    );

    return updatedSession;
  }

  async listProjectSessions(projectId: string): Promise<ProjectSession[]> {
    const rows = this.db.prepare('SELECT * FROM project_sessions WHERE project_id = ? ORDER BY started_at DESC')
      .all(projectId) as any[];
    return rows.map(row => this.rowToSession(row));
  }

  async incrementSessionCounts(sessionId: string, events: number = 1, toolCalls: number = 0): Promise<void> {
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
      notes: row.notes,
      // Session metadata
      cwd: row.cwd,
      transcriptPath: row.transcript_path,
      permissionMode: row.permission_mode,
      initialPrompt: row.initial_prompt,
      summary: row.session_summary,
      gitBranch: row.git_branch
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
    const now = Date.now();
    this.db.prepare(`
      UPDATE projects SET last_session_id = ?, last_activity_at = ?, updated_at = ?
      WHERE id = ?
    `).run(sessionId, now, now, projectId);
  }

  // Backfill session metadata from SessionStart events
  async backfillSessionMetadata(): Promise<{ updated: number; skipped: number }> {
    // Get all sessions without cwd (metadata not filled in)
    const sessionsWithoutCwd = this.db.prepare(`
      SELECT id FROM project_sessions WHERE cwd IS NULL
    `).all() as { id: string }[];

    let updated = 0;
    let skipped = 0;

    for (const { id: sessionId } of sessionsWithoutCwd) {
      // Find the first SessionStart event for this session
      const startEvent = this.db.prepare(`
        SELECT payload FROM events
        WHERE session_id = ? AND (hook_event_type = 'SessionStart' OR hook_event_type LIKE '%SessionStart%')
        ORDER BY timestamp ASC
        LIMIT 1
      `).get(sessionId) as { payload: string } | undefined;

      if (startEvent) {
        try {
          const payload = JSON.parse(startEvent.payload);
          const metadata: any = {};

          if (payload.cwd) metadata.cwd = payload.cwd;
          if (payload.transcript_path) metadata.transcriptPath = payload.transcript_path;
          if (payload.permission_mode) metadata.permissionMode = payload.permission_mode;

          if (Object.keys(metadata).length > 0) {
            await this.updateSession(sessionId, metadata);
            updated++;
          } else {
            skipped++;
          }
        } catch (e) {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    return { updated, skipped };
  }

  // ============================================
  // Project Settings Operations
  // ============================================

  async getProjectSettings(projectId: string, type?: SettingType): Promise<ProjectSetting[]> {
    let sql = 'SELECT * FROM project_settings WHERE project_id = ?';
    const params: any[] = [projectId];

    if (type) {
      sql += ' AND setting_type = ?';
      params.push(type);
    }

    sql += ' ORDER BY setting_key ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToProjectSetting(row));
  }

  async getProjectSetting(projectId: string, type: SettingType, key: string): Promise<ProjectSetting | null> {
    const row = this.db.prepare(
      'SELECT * FROM project_settings WHERE project_id = ? AND setting_type = ? AND setting_key = ?'
    ).get(projectId, type, key) as any;

    return row ? this.rowToProjectSetting(row) : null;
  }

  async insertProjectSetting(projectId: string, type: SettingType, input: ProjectSettingInput): Promise<ProjectSetting> {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO project_settings (id, project_id, setting_type, setting_key, setting_value, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      type,
      input.settingKey,
      JSON.stringify(input.settingValue),
      input.enabled !== false ? 1 : 0,
      now,
      now
    );

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
    const row = this.db.prepare('SELECT * FROM project_settings WHERE id = ?').get(id) as any;
    if (!row) return null;

    const now = Date.now();
    const current = this.rowToProjectSetting(row);

    const updated = {
      ...current,
      settingValue: updates.settingValue ?? current.settingValue,
      enabled: updates.enabled ?? current.enabled,
      updatedAt: now
    };

    this.db.prepare(`
      UPDATE project_settings SET setting_value = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(updated.settingValue),
      updated.enabled ? 1 : 0,
      now,
      id
    );

    return updated;
  }

  async deleteProjectSetting(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM project_settings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async bulkUpsertProjectSettings(projectId: string, type: SettingType, settings: ProjectSettingInput[]): Promise<ProjectSetting[]> {
    const results: ProjectSetting[] = [];
    const now = Date.now();

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
    return {
      id: row.id,
      projectId: row.project_id,
      settingType: row.setting_type as SettingType,
      settingKey: row.setting_key,
      settingValue: JSON.parse(row.setting_value),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
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
    const eventCountResult = this.db.prepare(
      'SELECT COUNT(*) as count FROM events WHERE session_id = ?'
    ).get(sessionId) as any;
    const eventCount = eventCountResult?.count || 0;

    // Move all events to new project
    this.db.prepare(
      'UPDATE events SET project_id = ? WHERE session_id = ?'
    ).run(newProjectId, sessionId);

    // Update session's project
    this.db.prepare(
      'UPDATE project_sessions SET project_id = ? WHERE id = ?'
    ).run(newProjectId, sessionId);

    // Update old project stats (decrement)
    const oldSessionStats = this.db.prepare(
      'SELECT SUM(event_count) as events, SUM(tool_call_count) as tools FROM project_sessions WHERE project_id = ?'
    ).get(oldProjectId) as any;

    // Update new project activity
    await this.updateProjectActivity(newProjectId, sessionId);

    // Return updated session
    const updatedSession = await this.getSession(sessionId);
    return {
      session: updatedSession!,
      movedEvents: eventCount
    };
  }

  // ============================================
  // Repository Operations (Multi-repo support)
  // ============================================

  async getProjectRepositories(projectId: string): Promise<Repository[]> {
    const rows = this.db.prepare(
      'SELECT * FROM project_repositories WHERE project_id = ? ORDER BY is_primary DESC, name ASC'
    ).all(projectId) as any[];
    return rows.map(row => this.rowToRepository(row));
  }

  async getRepository(id: string): Promise<Repository | null> {
    const row = this.db.prepare('SELECT * FROM project_repositories WHERE id = ?').get(id) as any;
    return row ? this.rowToRepository(row) : null;
  }

  async insertRepository(projectId: string, input: RepositoryInput): Promise<Repository> {
    const id = crypto.randomUUID();
    const now = Date.now();

    // Use transaction to ensure atomicity
    const insertTx = this.db.transaction(() => {
      // If this is set as primary, clear other primaries first
      if (input.isPrimary) {
        this.db.prepare('UPDATE project_repositories SET is_primary = 0 WHERE project_id = ?').run(projectId);
      }

      this.db.prepare(`
        INSERT INTO project_repositories (id, project_id, name, git_remote_url, local_path, git_branch, is_primary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        input.name,
        input.gitRemoteUrl || null,
        input.localPath || null,
        input.gitBranch || null,
        input.isPrimary ? 1 : 0,
        now
      );
    });

    insertTx();

    return {
      id,
      projectId,
      name: input.name,
      gitRemoteUrl: input.gitRemoteUrl,
      localPath: input.localPath,
      gitBranch: input.gitBranch,
      isPrimary: input.isPrimary || false,
      createdAt: now
    };
  }

  async updateRepository(id: string, updates: Partial<RepositoryInput>): Promise<Repository | null> {
    const row = this.db.prepare('SELECT * FROM project_repositories WHERE id = ?').get(id) as any;
    if (!row) return null;

    const current = this.rowToRepository(row);

    const updated = {
      ...current,
      name: updates.name ?? current.name,
      gitRemoteUrl: updates.gitRemoteUrl ?? current.gitRemoteUrl,
      localPath: updates.localPath ?? current.localPath,
      gitBranch: updates.gitBranch ?? current.gitBranch,
      isPrimary: updates.isPrimary ?? current.isPrimary
    };

    // Use transaction to ensure atomicity
    const updateTx = this.db.transaction(() => {
      // If setting as primary, clear other primaries first
      if (updates.isPrimary && !current.isPrimary) {
        this.db.prepare('UPDATE project_repositories SET is_primary = 0 WHERE project_id = ?').run(current.projectId);
      }

      this.db.prepare(`
        UPDATE project_repositories SET name = ?, git_remote_url = ?, local_path = ?, git_branch = ?, is_primary = ?
        WHERE id = ?
      `).run(
        updated.name,
        updated.gitRemoteUrl || null,
        updated.localPath || null,
        updated.gitBranch || null,
        updated.isPrimary ? 1 : 0,
        id
      );
    });

    updateTx();

    return updated;
  }

  async deleteRepository(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM project_repositories WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async setPrimaryRepository(projectId: string, repoId: string): Promise<boolean> {
    // First verify the repository belongs to this project
    const repo = this.db.prepare(
      'SELECT id FROM project_repositories WHERE id = ? AND project_id = ?'
    ).get(repoId, projectId);

    if (!repo) return false;

    // Use transaction to ensure atomicity
    const setPrimaryTx = this.db.transaction(() => {
      // Clear all primaries for this project
      this.db.prepare('UPDATE project_repositories SET is_primary = 0 WHERE project_id = ?').run(projectId);

      // Set the specified repo as primary
      this.db.prepare('UPDATE project_repositories SET is_primary = 1 WHERE id = ?').run(repoId);
    });

    setPrimaryTx();
    return true;
  }

  private rowToRepository(row: any): Repository {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      gitRemoteUrl: row.git_remote_url || undefined,
      localPath: row.local_path || undefined,
      gitBranch: row.git_branch || undefined,
      isPrimary: Boolean(row.is_primary),
      createdAt: row.created_at
    };
  }

  // ============================================
  // Session Settings Operations (Inheritance)
  // ============================================

  async getSessionSettings(sessionId: string, type?: SettingType): Promise<SessionSetting[]> {
    let sql = 'SELECT * FROM session_settings WHERE session_id = ?';
    const params: any[] = [sessionId];

    if (type) {
      sql += ' AND setting_type = ?';
      params.push(type);
    }

    sql += ' ORDER BY setting_key ASC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.rowToSessionSetting(row));
  }

  async getSessionSetting(sessionId: string, type: SettingType, key: string): Promise<SessionSetting | null> {
    const row = this.db.prepare(
      'SELECT * FROM session_settings WHERE session_id = ? AND setting_type = ? AND setting_key = ?'
    ).get(sessionId, type, key) as any;

    return row ? this.rowToSessionSetting(row) : null;
  }

  async insertSessionSetting(sessionId: string, type: SettingType, input: SessionSettingInput): Promise<SessionSetting> {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO session_settings (id, session_id, setting_type, setting_key, setting_value, override_mode, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      type,
      input.settingKey,
      JSON.stringify(input.settingValue),
      input.overrideMode || 'replace',
      input.enabled !== false ? 1 : 0,
      now,
      now
    );

    return {
      id,
      sessionId,
      settingType: type,
      settingKey: input.settingKey,
      settingValue: input.settingValue,
      overrideMode: input.overrideMode || 'replace',
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now
    };
  }

  async updateSessionSetting(id: string, updates: Partial<SessionSettingInput>): Promise<SessionSetting | null> {
    const row = this.db.prepare('SELECT * FROM session_settings WHERE id = ?').get(id) as any;
    if (!row) return null;

    const now = Date.now();
    const current = this.rowToSessionSetting(row);

    const updated = {
      ...current,
      settingValue: updates.settingValue ?? current.settingValue,
      overrideMode: updates.overrideMode ?? current.overrideMode,
      enabled: updates.enabled ?? current.enabled,
      updatedAt: now
    };

    this.db.prepare(`
      UPDATE session_settings SET setting_value = ?, override_mode = ?, enabled = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(updated.settingValue),
      updated.overrideMode,
      updated.enabled ? 1 : 0,
      now,
      id
    );

    return updated;
  }

  async deleteSessionSetting(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM session_settings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async bulkUpsertSessionSettings(sessionId: string, type: SettingType, settings: SessionSettingInput[]): Promise<SessionSetting[]> {
    const results: SessionSetting[] = [];
    const now = Date.now();

    for (const input of settings) {
      // Check if setting exists
      const existing = await this.getSessionSetting(sessionId, type, input.settingKey);

      if (existing) {
        // Update existing
        const updated = await this.updateSessionSetting(existing.id, {
          settingValue: input.settingValue,
          overrideMode: input.overrideMode,
          enabled: input.enabled
        });
        if (updated) results.push(updated);
      } else {
        // Insert new
        const created = await this.insertSessionSetting(sessionId, type, input);
        results.push(created);
      }
    }

    return results;
  }

  private rowToSessionSetting(row: any): SessionSetting {
    return {
      id: row.id,
      sessionId: row.session_id,
      settingType: row.setting_type as SettingType,
      settingKey: row.setting_key,
      settingValue: JSON.parse(row.setting_value),
      overrideMode: row.override_mode as OverrideMode,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Get effective settings by merging project and session settings
  async getEffectiveSettings(sessionId: string, type?: SettingType): Promise<ProjectSetting[]> {
    const session = await this.getSession(sessionId);
    if (!session) return [];

    // Get project settings
    const projectSettings = await this.getProjectSettings(session.projectId, type);

    // Get session overrides
    const sessionSettings = await this.getSessionSettings(sessionId, type);

    // Create a map of project settings by type+key
    const settingsMap = new Map<string, ProjectSetting>();
    for (const ps of projectSettings) {
      if (ps.enabled) {
        settingsMap.set(`${ps.settingType}:${ps.settingKey}`, ps);
      }
    }

    // Apply session overrides
    for (const ss of sessionSettings) {
      if (!ss.enabled) continue;

      const key = `${ss.settingType}:${ss.settingKey}`;
      const projectSetting = settingsMap.get(key);

      switch (ss.overrideMode) {
        case 'replace':
          // Completely replace project setting or add new
          settingsMap.set(key, {
            id: ss.id,
            projectId: session.projectId,
            settingType: ss.settingType,
            settingKey: ss.settingKey,
            settingValue: ss.settingValue,
            enabled: true,
            createdAt: ss.createdAt,
            updatedAt: ss.updatedAt
          });
          break;

        case 'extend':
          // Merge with project setting
          if (projectSetting) {
            settingsMap.set(key, {
              ...projectSetting,
              settingValue: this.deepMerge(projectSetting.settingValue, ss.settingValue),
              updatedAt: ss.updatedAt
            });
          } else {
            // No project setting to extend, just add
            settingsMap.set(key, {
              id: ss.id,
              projectId: session.projectId,
              settingType: ss.settingType,
              settingKey: ss.settingKey,
              settingValue: ss.settingValue,
              enabled: true,
              createdAt: ss.createdAt,
              updatedAt: ss.updatedAt
            });
          }
          break;

        case 'disable':
          // Remove from effective settings
          settingsMap.delete(key);
          break;
      }
    }

    return Array.from(settingsMap.values());
  }

  private deepMerge(target: any, source: any): any {
    if (Array.isArray(target) && Array.isArray(source)) {
      return [...target, ...source];
    }
    if (typeof target === 'object' && typeof source === 'object') {
      const result = { ...target };
      for (const key of Object.keys(source)) {
        result[key] = this.deepMerge(target[key], source[key]);
      }
      return result;
    }
    return source;
  }

  // ============================================
  // Orphaned Sessions (Unassigned Pool)
  // ============================================

  async getUnassignedSessions(limit: number = 50): Promise<ProjectSession[]> {
    // Sessions from auto-created projects (is_manual = false or null) that could be reassigned
    const rows = this.db.prepare(`
      SELECT ps.* FROM project_sessions ps
      INNER JOIN projects p ON ps.project_id = p.id
      WHERE (p.is_manual = 0 OR p.is_manual IS NULL)
      ORDER BY ps.started_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => this.rowToSession(row));
  }

  async assignSessionToProject(sessionId: string, projectId: string): Promise<ProjectSession | null> {
    // This is essentially reassignment but specifically for orphaned sessions
    const result = await this.reassignSession(sessionId, projectId);
    return result.session;
  }
}
