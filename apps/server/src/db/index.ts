/**
 * Database Factory
 *
 * Selects the appropriate database adapter based on environment configuration.
 * - If DATABASE_URL is set and starts with 'postgres://', uses PostgresAdapter
 * - Otherwise, uses SQLiteAdapter (default)
 *
 * All database operations are exported as functions that delegate to the active adapter.
 */

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
import { SqliteAdapter } from './sqlite-adapter';
import { PostgresAdapter } from './postgres-adapter';

let adapter: DatabaseAdapter;

/**
 * Initialize the database connection
 * Selects adapter based on DATABASE_URL environment variable
 */
export function initDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl && databaseUrl.startsWith('postgres://')) {
    console.log('[DB] PostgreSQL adapter selected');
    adapter = new PostgresAdapter(databaseUrl);
  } else {
    console.log('[DB] SQLite adapter selected');
    adapter = new SqliteAdapter('events.db');
  }

  adapter.init();
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (adapter) {
    adapter.close();
  }
}

// ============================================
// Event Operations
// ============================================

export function insertEvent(event: HookEvent): HookEvent {
  return adapter.insertEvent(event);
}

export function getRecentEvents(limit: number = 300): HookEvent[] {
  return adapter.getRecentEvents(limit);
}

export function getEventsBySessionId(sessionId: string): HookEvent[] {
  return adapter.getEventsBySessionId(sessionId);
}

export function getFilterOptions(): FilterOptions {
  return adapter.getFilterOptions();
}

export function updateEventHITLResponse(id: number, response: any): HookEvent | null {
  return adapter.updateEventHITLResponse(id, response);
}

// ============================================
// Theme Operations
// ============================================

export function insertTheme(theme: Theme): Theme {
  return adapter.insertTheme(theme);
}

export function updateTheme(id: string, updates: Partial<Theme>): boolean {
  return adapter.updateTheme(id, updates);
}

export function getTheme(id: string): Theme | null {
  return adapter.getTheme(id);
}

export function getThemes(query?: ThemeSearchQuery): Theme[] {
  return adapter.getThemes(query);
}

export function deleteTheme(id: string): boolean {
  return adapter.deleteTheme(id);
}

export function incrementThemeDownloadCount(id: string): boolean {
  return adapter.incrementThemeDownloadCount(id);
}

// ============================================
// Audio Cache Operations
// ============================================

export function insertAudioCache(entry: Omit<AudioCacheEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): AudioCacheEntry {
  return adapter.insertAudioCache(entry);
}

export function getAudioCacheByKey(key: string): AudioCacheEntry | null {
  return adapter.getAudioCacheByKey(key);
}

export function getAudioCacheStats(): { count: number; totalSize: number; keys: string[] } {
  return adapter.getAudioCacheStats();
}

export function deleteOldAudioCache(olderThanMs?: number): number {
  return adapter.deleteOldAudioCache(olderThanMs);
}

// ============================================
// Project Operations
// ============================================

export function getProject(id: string): Project | null {
  return adapter.getProject(id);
}

export function insertProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project {
  return adapter.insertProject(project);
}

export function updateProject(id: string, updates: Partial<Project>): Project | null {
  return adapter.updateProject(id, updates);
}

export function listProjects(query?: ProjectSearchQuery): Project[] {
  return adapter.listProjects(query);
}

export function archiveProject(id: string): boolean {
  return adapter.archiveProject(id);
}

// ============================================
// Session Operations
// ============================================

export function getSession(id: string): ProjectSession | null {
  return adapter.getSession(id);
}

export function insertSession(session: Omit<ProjectSession, 'eventCount' | 'toolCallCount'>): ProjectSession {
  return adapter.insertSession(session);
}

export function updateSession(id: string, updates: Partial<ProjectSession>): ProjectSession | null {
  return adapter.updateSession(id, updates);
}

export function listProjectSessions(projectId: string): ProjectSession[] {
  return adapter.listProjectSessions(projectId);
}

export function incrementSessionCounts(sessionId: string, events?: number, toolCalls?: number): void {
  adapter.incrementSessionCounts(sessionId, events, toolCalls);
}

// ============================================
// Auto-Registration Helpers
// ============================================

export function ensureProjectExists(sourceApp: string): Project {
  return adapter.ensureProjectExists(sourceApp);
}

export function ensureSessionExists(projectId: string, sessionId: string, modelName?: string): ProjectSession {
  return adapter.ensureSessionExists(projectId, sessionId, modelName);
}

export function updateProjectActivity(projectId: string, sessionId: string): void {
  adapter.updateProjectActivity(projectId, sessionId);
}

// Re-export types
export type { DatabaseAdapter, AudioCacheEntry } from './adapter';
