/**
 * Database Adapter Interface
 *
 * Defines the contract for all database operations.
 * Implementations: SQLiteAdapter, PostgresAdapter
 */

import type {
  HookEvent,
  FilterOptions,
  Theme,
  ThemeSearchQuery,
  Project,
  ProjectSession,
  ProjectSearchQuery
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
}
