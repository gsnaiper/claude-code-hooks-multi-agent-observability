/**
 * Embedding Service using Xenova Transformers
 *
 * Uses all-MiniLM-L6-v2 model for 384-dimensional embeddings.
 * Local inference, no API keys required.
 */

import { pipeline, env } from '@xenova/transformers';

// Configure cache directory for model downloads
env.cacheDir = process.env.EMBEDDING_CACHE_DIR || './data/models';

// Pipeline instance (lazy initialized)
let embedder: any = null;
let initPromise: Promise<void> | null = null;

const MODEL_NAME = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

/**
 * Initialize the embedding model (lazy, singleton)
 */
export async function initEmbedder(): Promise<void> {
  if (embedder) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    console.log(`[Embeddings] Loading model: ${MODEL_NAME}`);
    const startTime = Date.now();

    embedder = await pipeline('feature-extraction', MODEL_NAME);

    console.log(`[Embeddings] Model loaded in ${Date.now() - startTime}ms`);
  })();

  await initPromise;
}

/**
 * Generate embedding vector for text
 * @param text - Input text to embed
 * @returns 384-dimensional embedding vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embedder) {
    await initEmbedder();
  }

  // Truncate very long texts (model has token limit)
  const truncatedText = text.slice(0, 8000);

  const output = await embedder(truncatedText, {
    pooling: 'mean',
    normalize: true
  });

  // Convert to array and return
  return Array.from(output.data as Float32Array);
}

/**
 * Get embedding dimension
 */
export function getEmbeddingDimension(): number {
  return EMBEDDING_DIM;
}

/**
 * Check if embedder is ready
 */
export function isEmbedderReady(): boolean {
  return embedder !== null;
}
