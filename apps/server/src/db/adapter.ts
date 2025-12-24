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
 */
export interface DatabaseAdapter {
  // ============================================
  // Lifecycle
  // ============================================

  /** Initialize database connection and schema */
  init(): void;

  /** Close database connection */
  close(): void;

  // ============================================
  // Event Operations
  // ============================================

  /** Insert a new hook event */
  insertEvent(event: HookEvent): HookEvent;

  /** Get recent events (ordered by timestamp DESC, then reversed) */
  getRecentEvents(limit?: number): HookEvent[];

  /** Get all events for a session (ordered by timestamp ASC) */
  getEventsBySessionId(sessionId: string): HookEvent[];

  /** Get filter options (distinct values for source_app, session_id, hook_event_type) */
  getFilterOptions(): FilterOptions;

  /** Update HITL response status for an event */
  updateEventHITLResponse(id: number, response: any): HookEvent | null;

  // ============================================
  // Theme Operations
  // ============================================

  /** Insert a new theme */
  insertTheme(theme: Theme): Theme;

  /** Update theme fields */
  updateTheme(id: string, updates: Partial<Theme>): boolean;

  /** Get theme by ID */
  getTheme(id: string): Theme | null;

  /** Search themes with filters */
  getThemes(query?: ThemeSearchQuery): Theme[];

  /** Delete theme by ID */
  deleteTheme(id: string): boolean;

  /** Increment download count */
  incrementThemeDownloadCount(id: string): boolean;

  // ============================================
  // Audio Cache Operations
  // ============================================

  /** Insert audio cache entry */
  insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): AudioCacheEntry;

  /** Get audio cache entry by key (also updates access stats) */
  getAudioCacheByKey(key: string): AudioCacheEntry | null;

  /** Get audio cache statistics */
  getAudioCacheStats(): { count: number; totalSize: number; keys: string[] };

  /** Delete old audio cache entries */
  deleteOldAudioCache(olderThanMs?: number): number;

  // ============================================
  // Project Operations
  // ============================================

  /** Get project by ID */
  getProject(id: string): Project | null;

  /** Insert new project */
  insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project;

  /** Update project fields */
  updateProject(id: string, updates: Partial<Project>): Project | null;

  /** List projects with search/filter */
  listProjects(query?: ProjectSearchQuery): Project[];

  /** Archive project (set status to 'archived') */
  archiveProject(id: string): boolean;

  // ============================================
  // Session Operations
  // ============================================

  /** Get session by ID */
  getSession(id: string): ProjectSession | null;

  /** Insert new session */
  insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): ProjectSession;

  /** Update session fields */
  updateSession(id: string, updates: Partial<ProjectSession>): ProjectSession | null;

  /** List sessions for a project */
  listProjectSessions(projectId: string): ProjectSession[];

  /** Increment event/tool call counters */
  incrementSessionCounts(sessionId: string, events?: number, toolCalls?: number): void;

  // ============================================
  // Auto-Registration Helpers
  // ============================================

  /** Ensure project exists, create if not */
  ensureProjectExists(sourceApp: string): Project;

  /** Ensure session exists, create if not */
  ensureSessionExists(projectId: string, sessionId: string, modelName?: string): ProjectSession;

  /** Update project's last activity timestamp */
  updateProjectActivity(projectId: string, sessionId: string): void;
}
