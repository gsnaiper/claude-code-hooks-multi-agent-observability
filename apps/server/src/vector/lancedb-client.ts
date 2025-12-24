/**
 * LanceDB Client for Vector Search
 *
 * Stores event embeddings and provides similarity search.
 */

import * as lancedb from '@lancedb/lancedb';
import { generateEmbedding, getEmbeddingDimension } from './embeddings';

const TABLE_NAME = 'event_embeddings';

export interface EventEmbedding {
  event_id: number;
  session_id: string;
  project_id: string;
  content: string;
  vector: number[];
  created_at: number;
  [key: string]: unknown; // Index signature for LanceDB compatibility
}

export interface SearchResult {
  event_id: number;
  session_id: string;
  project_id: string;
  content: string;
  score: number;
}

export class LanceDBClient {
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || process.env.LANCEDB_PATH || './data/lancedb';
  }

  /**
   * Initialize LanceDB connection and table
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log(`[LanceDB] Connecting to: ${this.dbPath}`);

      this.db = await lancedb.connect(this.dbPath);

      // Check if table exists
      const tables = await this.db.tableNames();

      if (tables.includes(TABLE_NAME)) {
        console.log(`[LanceDB] Opening existing table: ${TABLE_NAME}`);
        this.table = await this.db.openTable(TABLE_NAME);
      } else {
        console.log(`[LanceDB] Table will be created on first insert`);
        // Table will be created on first insert with proper schema
      }

      this.initialized = true;
      console.log('[LanceDB] Initialized successfully');
    } catch (error) {
      console.error('[LanceDB] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Add an event embedding to the database
   */
  async addEvent(
    eventId: number,
    sessionId: string,
    projectId: string,
    content: string
  ): Promise<void> {
    if (!this.db) {
      throw new Error('LanceDB not initialized');
    }

    // Generate embedding
    const vector = await generateEmbedding(content);

    const record: EventEmbedding = {
      event_id: eventId,
      session_id: sessionId,
      project_id: projectId,
      content: content.slice(0, 2000), // Store truncated content for display
      vector,
      created_at: Date.now()
    };

    // Create table on first insert or add to existing
    if (!this.table) {
      console.log(`[LanceDB] Creating table: ${TABLE_NAME}`);
      this.table = await this.db.createTable(TABLE_NAME, [record]);
    } else {
      await this.table.add([record]);
    }
  }

  /**
   * Search for similar events
   */
  async search(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!this.table) {
      console.log('[LanceDB] No table exists yet, returning empty results');
      return [];
    }

    // Generate query embedding
    const queryVector = await generateEmbedding(query);

    // Perform vector search
    const results = await this.table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map((row: any) => ({
      event_id: row.event_id,
      session_id: row.session_id,
      project_id: row.project_id,
      content: row.content,
      score: row._distance ? 1 - row._distance : 1 // Convert distance to similarity
    }));
  }

  /**
   * Search within a specific session
   */
  async searchInSession(
    sessionId: string,
    query: string,
    limit: number = 20
  ): Promise<SearchResult[]> {
    if (!this.table) {
      return [];
    }

    const queryVector = await generateEmbedding(query);

    const results = await this.table
      .vectorSearch(queryVector)
      .where(`session_id = '${sessionId}'`)
      .limit(limit)
      .toArray();

    return results.map((row: any) => ({
      event_id: row.event_id,
      session_id: row.session_id,
      project_id: row.project_id,
      content: row.content,
      score: row._distance ? 1 - row._distance : 1
    }));
  }

  /**
   * Search within a specific project
   */
  async searchInProject(
    projectId: string,
    query: string,
    limit: number = 20
  ): Promise<SearchResult[]> {
    if (!this.table) {
      return [];
    }

    const queryVector = await generateEmbedding(query);

    const results = await this.table
      .vectorSearch(queryVector)
      .where(`project_id = '${projectId}'`)
      .limit(limit)
      .toArray();

    return results.map((row: any) => ({
      event_id: row.event_id,
      session_id: row.session_id,
      project_id: row.project_id,
      content: row.content,
      score: row._distance ? 1 - row._distance : 1
    }));
  }

  /**
   * Get statistics about the vector database
   */
  async getStats(): Promise<{ count: number; hasTable: boolean }> {
    if (!this.table) {
      return { count: 0, hasTable: false };
    }

    const count = await this.table.countRows();
    return { count, hasTable: true };
  }

  /**
   * Check if client is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    // LanceDB doesn't require explicit close
    this.initialized = false;
    this.db = null;
    this.table = null;
  }
}
