/**
 * Embedding Queue - Async Background Processing
 *
 * Processes event embeddings asynchronously to avoid blocking event ingestion.
 * Includes retry logic and graceful degradation.
 */

import { LanceDBClient, type SearchResult } from './lancedb-client';
import { initEmbedder, isEmbedderReady } from './embeddings';

const MAX_RETRIES = 3;
const BATCH_SIZE = 5;
const PROCESS_INTERVAL_MS = 1000;

interface QueueItem {
  eventId: number;
  sessionId: string;
  projectId: string;
  content: string;
  retries: number;
  addedAt: number;
}

export class EmbeddingQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private lancedb: LanceDBClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private enabled = true;
  private processedCount = 0;
  private failedCount = 0;

  constructor(lancedbPath?: string) {
    this.lancedb = new LanceDBClient(lancedbPath);
  }

  /**
   * Initialize the queue and start background processing
   */
  async init(): Promise<void> {
    try {
      // Initialize LanceDB
      await this.lancedb.init();

      // Pre-warm the embedding model
      console.log('[EmbeddingQueue] Pre-loading embedding model...');
      await initEmbedder();

      // Start background worker
      this.startWorker();

      console.log('[EmbeddingQueue] Initialized successfully');
    } catch (error) {
      console.error('[EmbeddingQueue] Initialization failed:', error);
      this.enabled = false;
      console.warn('[EmbeddingQueue] Semantic search disabled due to init failure');
    }
  }

  /**
   * Add an event to the embedding queue (non-blocking)
   */
  enqueue(
    eventId: number,
    sessionId: string,
    projectId: string,
    content: string
  ): void {
    if (!this.enabled) {
      return; // Silently ignore when disabled
    }

    this.queue.push({
      eventId,
      sessionId,
      projectId,
      content,
      retries: 0,
      addedAt: Date.now()
    });
  }

  /**
   * Start the background worker
   */
  private startWorker(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[EmbeddingQueue] Worker error:', err);
      });
    }, PROCESS_INTERVAL_MS);

    console.log('[EmbeddingQueue] Background worker started');
  }

  /**
   * Process items from the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      // Take a batch from the queue
      const batch = this.queue.splice(0, BATCH_SIZE);

      for (const item of batch) {
        try {
          await this.lancedb.addEvent(
            item.eventId,
            item.sessionId,
            item.projectId,
            item.content
          );
          this.processedCount++;
        } catch (error) {
          console.error(`[EmbeddingQueue] Failed to embed event ${item.eventId}:`, error);

          // Retry logic
          if (item.retries < MAX_RETRIES) {
            item.retries++;
            this.queue.push(item); // Re-add to queue
          } else {
            console.error(`[EmbeddingQueue] Giving up on event ${item.eventId} after ${MAX_RETRIES} retries`);
            this.failedCount++;
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Search for similar events
   */
  async search(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!this.enabled) {
      return [];
    }

    return this.lancedb.search(query, limit);
  }

  /**
   * Search within a session
   */
  async searchInSession(
    sessionId: string,
    query: string,
    limit: number = 20
  ): Promise<SearchResult[]> {
    if (!this.enabled) {
      return [];
    }

    return this.lancedb.searchInSession(sessionId, query, limit);
  }

  /**
   * Search within a project
   */
  async searchInProject(
    projectId: string,
    query: string,
    limit: number = 20
  ): Promise<SearchResult[]> {
    if (!this.enabled) {
      return [];
    }

    return this.lancedb.searchInProject(projectId, query, limit);
  }

  /**
   * Get queue and processing statistics
   */
  async getStats(): Promise<{
    queueLength: number;
    processedCount: number;
    failedCount: number;
    enabled: boolean;
    lancedbStats: { count: number; hasTable: boolean };
  }> {
    const lancedbStats = await this.lancedb.getStats();

    return {
      queueLength: this.queue.length,
      processedCount: this.processedCount,
      failedCount: this.failedCount,
      enabled: this.enabled,
      lancedbStats
    };
  }

  /**
   * Check if queue is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Stop the background worker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[EmbeddingQueue] Background worker stopped');
    }
  }

  /**
   * Shutdown gracefully - process remaining items
   */
  async shutdown(): Promise<void> {
    this.stop();

    // Process remaining items
    while (this.queue.length > 0) {
      await this.processQueue();
    }

    await this.lancedb.close();
    console.log('[EmbeddingQueue] Shutdown complete');
  }
}
