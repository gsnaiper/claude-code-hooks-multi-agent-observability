import { ref } from 'vue';

const DB_NAME = 'voiceNotifications';
const STORE_NAME = 'audioCache';
const DB_VERSION = 1;

// ElevenLabs configuration
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';

interface CachedAudio {
  key: string;
  audioBlob: Blob;
  createdAt: number;
  text: string;
}

// Singleton instance for shared state
let instance: ReturnType<typeof createAudioCache> | null = null;

function createAudioCache() {
  const cache = ref<Map<string, Blob>>(new Map());
  const isLoading = ref<Map<string, boolean>>(new Map());
  let db: IDBDatabase | null = null;
  let initPromise: Promise<IDBDatabase> | null = null;

  // Initialize IndexedDB
  const initDB = async (): Promise<IDBDatabase> => {
    if (db) return db;
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
    });

    return initPromise;
  };

  // Load all cached audio from IndexedDB into memory
  const loadCache = async (): Promise<void> => {
    try {
      const database = await initDB();
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const items = request.result as CachedAudio[];
          items.forEach(item => {
            cache.value.set(item.key, item.audioBlob);
          });
          console.log(`[AudioCache] Loaded ${items.length} cached audio items`);
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('[AudioCache] Failed to load cache:', error);
    }
  };

  // Save audio blob to IndexedDB
  const saveToCache = async (key: string, blob: Blob, text: string): Promise<void> => {
    try {
      const database = await initDB();
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const item: CachedAudio = {
        key,
        audioBlob: blob,
        createdAt: Date.now(),
        text
      };

      store.put(item);
      cache.value.set(key, blob);
      console.log(`[AudioCache] Saved: ${key}`);
    } catch (error) {
      console.error('[AudioCache] Failed to save:', error);
    }
  };

  // Get from memory cache
  const getFromCache = (key: string): Blob | null => {
    return cache.value.get(key) || null;
  };

  // Generate audio via ElevenLabs API
  const generateViaAPI = async (text: string, voiceId: string): Promise<Blob> => {
    if (!ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key not configured');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text.slice(0, 500),
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    return response.blob();
  };

  // Get from cache or generate via API (with caching)
  const getOrGenerate = async (key: string, text: string, voiceId: string): Promise<Blob> => {
    // Check memory cache first
    const cached = cache.value.get(key);
    if (cached) {
      console.log(`[AudioCache] Hit: ${key}`);
      return cached;
    }

    // Check if already loading
    if (isLoading.value.get(key)) {
      // Wait for existing request
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          const blob = cache.value.get(key);
          if (blob) {
            clearInterval(checkInterval);
            resolve(blob);
          }
        }, 100);
      });
    }

    // Mark as loading
    isLoading.value.set(key, true);
    console.log(`[AudioCache] Miss, generating: ${key}`);

    try {
      const blob = await generateViaAPI(text, voiceId);
      await saveToCache(key, blob, text);
      return blob;
    } finally {
      isLoading.value.delete(key);
    }
  };

  // Generate without caching (for dynamic content)
  const generateWithoutCache = async (text: string, voiceId: string): Promise<Blob> => {
    console.log(`[AudioCache] Generating dynamic (no cache): ${text.slice(0, 30)}...`);
    return generateViaAPI(text, voiceId);
  };

  // Clear all cached audio
  const clearCache = async (): Promise<void> => {
    try {
      const database = await initDB();
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      cache.value.clear();
      console.log('[AudioCache] Cache cleared');
    } catch (error) {
      console.error('[AudioCache] Failed to clear cache:', error);
    }
  };

  // Get cache statistics
  const getCacheStats = () => {
    return {
      itemCount: cache.value.size,
      keys: Array.from(cache.value.keys())
    };
  };

  return {
    initDB,
    loadCache,
    saveToCache,
    getFromCache,
    getOrGenerate,
    generateWithoutCache,
    clearCache,
    getCacheStats,
    cache,
    isLoading
  };
}

export function useAudioCache() {
  if (!instance) {
    instance = createAudioCache();
  }
  return instance;
}
