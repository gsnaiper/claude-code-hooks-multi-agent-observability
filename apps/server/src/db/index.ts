/**
 * Database Factory
 *
 * Selects the appropriate database adapter based on environment configuration.
 * - If DATABASE_URL is set and starts with 'postgres://', uses PostgresAdapter
 * - Otherwise, uses SQLiteAdapter (default)
 *
 * All database operations are exported as async functions that delegate to the active adapter.
 */

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
  SessionSettingInput
} from '../types';
import { SqliteAdapter } from './sqlite-adapter';
import { PostgresAdapter } from './postgres-adapter';

let adapter: DatabaseAdapter;

/**
 * Initialize the database connection
 * Selects adapter based on DATABASE_URL environment variable
 */
export async function initDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.startsWith('postgres://')) {
    console.log('[DB] PostgreSQL adapter selected');
    adapter = new PostgresAdapter(databaseUrl);
  } else {
    console.log('[DB] SQLite adapter selected');
    adapter = new SqliteAdapter('events.db');
  }

  await adapter.init();
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
  if (adapter) {
    await adapter.close();
  }
}

// ============================================
// Event Operations
// ============================================

export function insertEvent(event: HookEvent): Promise<HookEvent> {
  return adapter.insertEvent(event);
}

export function getRecentEvents(limit: number = 300): Promise<HookEvent[]> {
  return adapter.getRecentEvents(limit);
}

export function getEventsBySessionId(sessionId: string): Promise<HookEvent[]> {
  return adapter.getEventsBySessionId(sessionId);
}

export function getFilterOptions(): Promise<FilterOptions> {
  return adapter.getFilterOptions();
}

export function updateEventHITLResponse(id: number, response: any): Promise<HookEvent | null> {
  return adapter.updateEventHITLResponse(id, response);
}

export function getEventSummaries(filters?: EventFilters): Promise<EventSummary[]> {
  return adapter.getEventSummaries(filters);
}

export function getEventById(id: number): Promise<HookEvent | null> {
  return adapter.getEventById(id);
}

// ============================================
// Theme Operations
// ============================================

export function insertTheme(theme: Theme): Promise<Theme> {
  return adapter.insertTheme(theme);
}

export function updateTheme(id: string, updates: Partial<Theme>): Promise<boolean> {
  return adapter.updateTheme(id, updates);
}

export function getTheme(id: string): Promise<Theme | null> {
  return adapter.getTheme(id);
}

export function getThemes(query?: ThemeSearchQuery): Promise<Theme[]> {
  return adapter.getThemes(query);
}

export function deleteTheme(id: string): Promise<boolean> {
  return adapter.deleteTheme(id);
}

export function incrementThemeDownloadCount(id: string): Promise<boolean> {
  return adapter.incrementThemeDownloadCount(id);
}

// ============================================
// Audio Cache Operations
// ============================================

export function insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): Promise<AudioCacheEntry> {
  return adapter.insertAudioCache(entry);
}

export function getAudioCacheByKey(key: string): Promise<AudioCacheEntry | null> {
  return adapter.getAudioCacheByKey(key);
}

export function getAudioCacheStats(): Promise<{ count: number; totalSize: number; keys: string[] }> {
  return adapter.getAudioCacheStats();
}

export function deleteOldAudioCache(olderThanMs?: number): Promise<number> {
  return adapter.deleteOldAudioCache(olderThanMs);
}

// ============================================
// Project Operations
// ============================================

export function getProject(id: string): Promise<Project | null> {
  return adapter.getProject(id);
}

export function insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> {
  return adapter.insertProject(project);
}

export function updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
  return adapter.updateProject(id, updates);
}

export function listProjects(query?: ProjectSearchQuery): Promise<Project[]> {
  return adapter.listProjects(query);
}

export function archiveProject(id: string): Promise<boolean> {
  return adapter.archiveProject(id);
}

// ============================================
// Session Operations
// ============================================

export function getSession(id: string): Promise<ProjectSession | null> {
  return adapter.getSession(id);
}

export function insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): Promise<ProjectSession> {
  return adapter.insertSession(session);
}

export function updateSession(id: string, updates: Partial<ProjectSession>): Promise<ProjectSession | null> {
  return adapter.updateSession(id, updates);
}

export function listProjectSessions(projectId: string): Promise<ProjectSession[]> {
  return adapter.listProjectSessions(projectId);
}

export function incrementSessionCounts(sessionId: string, events?: number, toolCalls?: number): Promise<void> {
  return adapter.incrementSessionCounts(sessionId, events, toolCalls);
}

// ============================================
// Auto-Registration Helpers
// ============================================

export function ensureProjectExists(sourceApp: string): Promise<Project> {
  return adapter.ensureProjectExists(sourceApp);
}

export function ensureSessionExists(projectId: string, sessionId: string, modelName?: string): Promise<ProjectSession> {
  return adapter.ensureSessionExists(projectId, sessionId, modelName);
}

export function updateProjectActivity(projectId: string, sessionId: string): Promise<void> {
  return adapter.updateProjectActivity(projectId, sessionId);
}

// ============================================
// Project Settings Operations
// ============================================

export function getProjectSettings(projectId: string, type?: SettingType): Promise<ProjectSetting[]> {
  return adapter.getProjectSettings(projectId, type);
}

export function getProjectSetting(projectId: string, type: SettingType, key: string): Promise<ProjectSetting | null> {
  return adapter.getProjectSetting(projectId, type, key);
}

export function insertProjectSetting(projectId: string, type: SettingType, input: ProjectSettingInput): Promise<ProjectSetting> {
  return adapter.insertProjectSetting(projectId, type, input);
}

export function updateProjectSetting(id: string, updates: Partial<ProjectSettingInput>): Promise<ProjectSetting | null> {
  return adapter.updateProjectSetting(id, updates);
}

export function deleteProjectSetting(id: string): Promise<boolean> {
  return adapter.deleteProjectSetting(id);
}

export function bulkUpsertProjectSettings(projectId: string, type: SettingType, settings: ProjectSettingInput[]): Promise<ProjectSetting[]> {
  return adapter.bulkUpsertProjectSettings(projectId, type, settings);
}

// ============================================
// Session Reassignment
// ============================================

export function reassignSession(sessionId: string, newProjectId: string): Promise<{ session: ProjectSession; movedEvents: number }> {
  return adapter.reassignSession(sessionId, newProjectId);
}

export function backfillSessionMetadata(): Promise<{ updated: number; skipped: number }> {
  return adapter.backfillSessionMetadata();
}

// ============================================
// Repository Operations
// ============================================

export function getProjectRepositories(projectId: string): Promise<Repository[]> {
  return adapter.getProjectRepositories(projectId);
}

export function getRepository(id: string): Promise<Repository | null> {
  return adapter.getRepository(id);
}

export function insertRepository(projectId: string, input: RepositoryInput): Promise<Repository> {
  return adapter.insertRepository(projectId, input);
}

export function updateRepository(id: string, updates: Partial<RepositoryInput>): Promise<Repository | null> {
  return adapter.updateRepository(id, updates);
}

export function deleteRepository(id: string): Promise<boolean> {
  return adapter.deleteRepository(id);
}

export function setPrimaryRepository(projectId: string, repoId: string): Promise<boolean> {
  return adapter.setPrimaryRepository(projectId, repoId);
}

// ============================================
// Session Settings Operations
// ============================================

export function getSessionSettings(sessionId: string, type?: SettingType): Promise<SessionSetting[]> {
  return adapter.getSessionSettings(sessionId, type);
}

export function getSessionSetting(sessionId: string, type: SettingType, key: string): Promise<SessionSetting | null> {
  return adapter.getSessionSetting(sessionId, type, key);
}

export function insertSessionSetting(sessionId: string, type: SettingType, input: SessionSettingInput): Promise<SessionSetting> {
  return adapter.insertSessionSetting(sessionId, type, input);
}

export function updateSessionSetting(id: string, updates: Partial<SessionSettingInput>): Promise<SessionSetting | null> {
  return adapter.updateSessionSetting(id, updates);
}

export function deleteSessionSetting(id: string): Promise<boolean> {
  return adapter.deleteSessionSetting(id);
}

export function bulkUpsertSessionSettings(sessionId: string, type: SettingType, settings: SessionSettingInput[]): Promise<SessionSetting[]> {
  return adapter.bulkUpsertSessionSettings(sessionId, type, settings);
}

export function getEffectiveSettings(sessionId: string, type?: SettingType): Promise<ProjectSetting[]> {
  return adapter.getEffectiveSettings(sessionId, type);
}

// ============================================
// Orphaned Sessions Operations
// ============================================

export function getUnassignedSessions(): Promise<ProjectSession[]> {
  return adapter.getUnassignedSessions();
}

export function assignSessionToProject(sessionId: string, projectId: string): Promise<ProjectSession | null> {
  return adapter.assignSessionToProject(sessionId, projectId);
}

// Re-export types
export type { DatabaseAdapter, AudioCacheEntry } from './adapter';
