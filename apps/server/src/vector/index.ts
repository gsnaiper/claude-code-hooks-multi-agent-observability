/**
 * Vector Search Module
 *
 * Re-exports for semantic search functionality using LanceDB.
 */

export { EmbeddingQueue } from './embedding-queue';
export { LanceDBClient, type SearchResult, type EventEmbedding } from './lancedb-client';
export { generateEmbedding, initEmbedder, isEmbedderReady, getEmbeddingDimension } from './embeddings';
export { extractSearchableContent, hasSearchableContent } from './content-extractor';
