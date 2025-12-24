/**
 * Database Adapter Interface
 *
 * Defines the contract for all database operations.
 * Implementations: SQLiteAdapter, PostgresAdapter
 */

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

/**
 * Audio cache entry stored in database
 */
export interface AudioCacheEntry {
  id: string;
  key: string;
  audioData: string; // base64 encoded
  mimeType: string;
  voiceId?: string;
  textHash?: string;
  sourceApp?: string;
  createdAt: number;
  accessedAt: number;
  accessCount: number;
  sizeBytes?: number;
}

/**
 * Database adapter interface
 * All database implementations must conform to this contract
 *
 * Note: All methods are async to support both sync (SQLite) and async (Postgres) adapters
 */
export interface DatabaseAdapter {
  // ============================================
  // Lifecycle
  // ============================================

  /** Initialize database connection and schema */
  init(): Promise<void>;

  /** Close database connection */
  close(): Promise<void>;

  // ============================================
  // Event Operations
  // ============================================

  /** Insert a new hook event */
  insertEvent(event: HookEvent): Promise<HookEvent>;

  /** Get recent events (ordered by timestamp DESC, then reversed) */
  getRecentEvents(limit?: number): Promise<HookEvent[]>;

  /** Get all events for a session (ordered by timestamp ASC) */
  getEventsBySessionId(sessionId: string): Promise<HookEvent[]>;

  /** Get filter options (distinct values for source_app, session_id, hook_event_type) */
  getFilterOptions(): Promise<FilterOptions>;

  /** Update HITL response status for an event */
  updateEventHITLResponse(id: number, response: any): Promise<HookEvent | null>;

  /** Get event summaries (lightweight, no payload/chat) with filters */
  getEventSummaries(filters?: EventFilters): Promise<EventSummary[]>;

  /** Get single event by ID (full event with payload) */
  getEventById(id: number): Promise<HookEvent | null>;

  // ============================================
  // Theme Operations
  // ============================================

  /** Insert a new theme */
  insertTheme(theme: Theme): Promise<Theme>;

  /** Update theme fields */
  updateTheme(id: string, updates: Partial<Theme>): Promise<boolean>;

  /** Get theme by ID */
  getTheme(id: string): Promise<Theme | null>;

  /** Search themes with filters */
  getThemes(query?: ThemeSearchQuery): Promise<Theme[]>;

  /** Delete theme by ID */
  deleteTheme(id: string): Promise<boolean>;

  /** Increment download count */
  incrementThemeDownloadCount(id: string): Promise<boolean>;

  // ============================================
  // Audio Cache Operations
  // ============================================

  /** Insert audio cache entry */
  insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): Promise<AudioCacheEntry>;

  /** Get audio cache entry by key (also updates access stats) */
  getAudioCacheByKey(key: string): Promise<AudioCacheEntry | null>;

  /** Get audio cache statistics */
  getAudioCacheStats(): Promise<{ count: number; totalSize: number; keys: string[] }>;

  /** Delete old audio cache entries */
  deleteOldAudioCache(olderThanMs?: number): Promise<number>;

  // ============================================
  // Project Operations
  // ============================================

  /** Get project by ID */
  getProject(id: string): Promise<Project | null>;

  /** Insert new project */
  insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project>;

  /** Update project fields */
  updateProject(id: string, updates: Partial<Project>): Promise<Project | null>;

  /** List projects with search/filter */
  listProjects(query?: ProjectSearchQuery): Promise<Project[]>;

  /** Archive project (set status to 'archived') */
  archiveProject(id: string): Promise<boolean>;

  // ============================================
  // Session Operations
  // ============================================

  /** Get session by ID */
  getSession(id: string): Promise<ProjectSession | null>;

  /** Insert new session */
  insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): Promise<ProjectSession>;

  /** Update session fields */
  updateSession(id: string, updates: Partial<ProjectSession>): Promise<ProjectSession | null>;

  /** List sessions for a project */
  listProjectSessions(projectId: string): Promise<ProjectSession[]>;

  /** Increment event/tool call counters */
  incrementSessionCounts(sessionId: string, events?: number, toolCalls?: number): Promise<void>;

  // ============================================
  // Auto-Registration Helpers
  // ============================================

  /** Ensure project exists, create if not */
  ensureProjectExists(sourceApp: string): Promise<Project>;

  /** Ensure session exists, create if not */
  ensureSessionExists(projectId: string, sessionId: string, modelName?: string): Promise<ProjectSession>;

  /** Update project's last activity timestamp */
  updateProjectActivity(projectId: string, sessionId: string): Promise<void>;

  // ============================================
  // Project Settings Operations
  // ============================================

  /** Get all settings for a project, optionally filtered by type */
  getProjectSettings(projectId: string, type?: SettingType): Promise<ProjectSetting[]>;

  /** Get a specific setting by project, type, and key */
  getProjectSetting(projectId: string, type: SettingType, key: string): Promise<ProjectSetting | null>;

  /** Insert a new project setting */
  insertProjectSetting(projectId: string, type: SettingType, input: ProjectSettingInput): Promise<ProjectSetting>;

  /** Update an existing project setting */
  updateProjectSetting(id: string, updates: Partial<ProjectSettingInput>): Promise<ProjectSetting | null>;

  /** Delete a project setting */
  deleteProjectSetting(id: string): Promise<boolean>;

  /** Bulk upsert settings of a specific type for a project */
  bulkUpsertProjectSettings(projectId: string, type: SettingType, settings: ProjectSettingInput[]): Promise<ProjectSetting[]>;

  // ============================================
  // Session Reassignment
  // ============================================

  /** Reassign a session to a different project, moving all events */
  reassignSession(sessionId: string, newProjectId: string): Promise<{ session: ProjectSession; movedEvents: number }>;

  /** Backfill session metadata from SessionStart events */
  backfillSessionMetadata(): Promise<{ updated: number; skipped: number }>;

  // ============================================
  // Repository Operations
  // ============================================

  /** Get all repositories for a project */
  getProjectRepositories(projectId: string): Promise<Repository[]>;

  /** Get a specific repository by ID */
  getRepository(id: string): Promise<Repository | null>;

  /** Insert a new repository */
  insertRepository(projectId: string, input: RepositoryInput): Promise<Repository>;

  /** Update repository fields */
  updateRepository(id: string, updates: Partial<RepositoryInput>): Promise<Repository | null>;

  /** Delete a repository */
  deleteRepository(id: string): Promise<boolean>;

  /** Set primary repository for a project */
  setPrimaryRepository(projectId: string, repoId: string): Promise<boolean>;

  // ============================================
  // Session Settings Operations
  // ============================================

  /** Get all settings for a session, optionally filtered by type */
  getSessionSettings(sessionId: string, type?: SettingType): Promise<SessionSetting[]>;

  /** Get a specific session setting by session, type, and key */
  getSessionSetting(sessionId: string, type: SettingType, key: string): Promise<SessionSetting | null>;

  /** Insert a new session setting */
  insertSessionSetting(sessionId: string, type: SettingType, input: SessionSettingInput): Promise<SessionSetting>;

  /** Update an existing session setting */
  updateSessionSetting(id: string, updates: Partial<SessionSettingInput>): Promise<SessionSetting | null>;

  /** Delete a session setting */
  deleteSessionSetting(id: string): Promise<boolean>;

  /** Bulk upsert session settings of a specific type */
  bulkUpsertSessionSettings(sessionId: string, type: SettingType, settings: SessionSettingInput[]): Promise<SessionSetting[]>;

  /** Get effective settings (project settings merged with session overrides) */
  getEffectiveSettings(sessionId: string, type?: SettingType): Promise<ProjectSetting[]>;

  // ============================================
  // Orphaned Sessions Operations
  // ============================================

  /** Get sessions from auto-created projects (unassigned) */
  getUnassignedSessions(): Promise<ProjectSession[]>;

  /** Assign an orphaned session to a manually created project */
  assignSessionToProject(sessionId: string, projectId: string): Promise<ProjectSession | null>;
}
