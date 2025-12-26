import { ref } from 'vue';
import { API_BASE_URL } from '../config';

const DB_NAME = 'voiceNotifications';
const STORE_NAME = 'audioCache';
const DB_VERSION = 1;

// ElevenLabs configuration
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';

// Audio generation result with cost info
export interface AudioGenerationResult {
  blob: Blob;
  characterCost: number;
}

// ElevenLabs subscription info
export interface ElevenLabsSubscription {
  characterCount: number;
  characterLimit: number;
  nextResetUnix: number | null;
  tier: string;
  status: string;
}

// API Key info for multi-key support
export interface ApiKeyInfo {
  key: string;           // Full API key
  label: string;         // Label (e.g. "Default", "Personal", "Work")
  subscription: ElevenLabsSubscription | null;
  lastChecked: number;   // Unix timestamp of last balance check
  isActive: boolean;     // Is this key enabled for use
}

// Simple hash function for cache keys
const hashText = (text: string): string => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

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

  // Upload audio to backend for persistent storage
  const uploadToBackend = async (blob: Blob, text: string, voiceId: string, sourceApp?: string): Promise<void> => {
    try {
      // Convert blob to base64
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      const textHash = hashText(text);
      const key = `${voiceId}_${textHash}`;

      const response = await fetch(`${API_BASE_URL}/api/audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key,
          audioData: base64,
          mimeType: blob.type || 'audio/mpeg',
          voiceId,
          textHash,
          sourceApp
        })
      });

      if (!response.ok) {
        throw new Error(`Backend upload failed: ${response.status}`);
      }

      console.log(`[AudioCache] Uploaded to backend: ${key}`);
    } catch (error) {
      // Non-critical - log but don't fail
      console.warn('[AudioCache] Backend upload failed:', error);
    }
  };

  // Get from memory cache
  const getFromCache = (key: string): Blob | null => {
    return cache.value.get(key) || null;
  };

  // Track last generation cost
  const lastCharacterCost = ref<number>(0);

  // Select best API key (lowest usage %) for load balancing
  const selectBestKey = (apiKeys: ApiKeyInfo[]): ApiKeyInfo | null => {
    const activeKeys = apiKeys.filter(k => k.isActive && k.subscription);
    if (activeKeys.length === 0) return null;

    // Sort by usage % (ascending)
    activeKeys.sort((a, b) => {
      const usageA = a.subscription!.characterCount / a.subscription!.characterLimit;
      const usageB = b.subscription!.characterCount / b.subscription!.characterLimit;
      return usageA - usageB;
    });

    return activeKeys[0];
  };

  // Generate audio via ElevenLabs API
  const generateViaAPI = async (text: string, voiceId: string, apiKeyOverride?: string): Promise<AudioGenerationResult> => {
    const apiKey = apiKeyOverride || ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
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

    // Extract character cost from headers
    // ElevenLabs uses 'character-cost' or falls back to text length
    const characterCostHeader = response.headers.get('character-cost')
      || response.headers.get('x-character-cost');
    const characterCost = characterCostHeader
      ? parseInt(characterCostHeader, 10)
      : text.slice(0, 500).length; // Fallback to text length

    lastCharacterCost.value = characterCost;

    const blob = await response.blob();
    return { blob, characterCost };
  };

  // Fetch ElevenLabs subscription info for a specific key
  const fetchSubscriptionForKey = async (apiKey: string): Promise<ElevenLabsSubscription | null> => {
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch('/api/elevenlabs/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ apiKey })
      });

      if (!response.ok) {
        throw new Error(`Subscription API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        characterCount: data.character_count,
        characterLimit: data.character_limit,
        nextResetUnix: data.next_character_count_reset_unix,
        tier: data.tier,
        status: data.status
      };
    } catch (error) {
      console.error('[AudioCache] Failed to fetch subscription:', error);
      return null;
    }
  };

  // Fetch ElevenLabs subscription info (uses default env key)
  const fetchSubscription = async (): Promise<ElevenLabsSubscription | null> => {
    return fetchSubscriptionForKey(ELEVENLABS_API_KEY);
  };

  // Refresh subscription info for all keys
  const refreshAllKeys = async (apiKeys: ApiKeyInfo[]): Promise<ApiKeyInfo[]> => {
    const updated = await Promise.all(
      apiKeys.map(async (keyInfo) => {
        const subscription = await fetchSubscriptionForKey(keyInfo.key);
        return {
          ...keyInfo,
          subscription,
          lastChecked: Date.now()
        };
      })
    );
    return updated;
  };

  // Get from cache or generate via API (with caching)
  const getOrGenerate = async (key: string, text: string, voiceId: string): Promise<Blob> => {
    // Check memory cache first
    const cached = cache.value.get(key);
    if (cached) {
      console.log(`[AudioCache] Hit: ${key}`);
      lastCharacterCost.value = 0; // Cache hit = no cost
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
      const result = await generateViaAPI(text, voiceId);
      await saveToCache(key, result.blob, text);
      return result.blob;
    } finally {
      isLoading.value.delete(key);
    }
  };

  // Generate without local caching (for dynamic content) - uploads to backend for persistence
  // Returns blob and characterCost
  const generateWithoutCache = async (text: string, voiceId: string, sourceApp?: string, apiKeyOverride?: string): Promise<AudioGenerationResult> => {
    console.log(`[AudioCache] Generating dynamic: ${text.slice(0, 30)}...`);
    const result = await generateViaAPI(text, voiceId, apiKeyOverride);

    // Upload to backend in background (non-blocking)
    uploadToBackend(result.blob, text, voiceId, sourceApp).catch(() => {
      // Already logged in uploadToBackend
    });

    return result;
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

  // Transcribe audio via ElevenLabs Speech-to-Text API
  const transcribeAudio = async (
    audioBlob: Blob,
    languageCode?: string,
    apiKeyOverride?: string
  ): Promise<string> => {
    const apiKey = apiKeyOverride || ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    // Derive file extension from MIME type
    const getFileExtension = (mimeType: string): string => {
      if (mimeType.includes('webm')) return 'webm';
      if (mimeType.includes('mp4')) return 'mp4';
      if (mimeType.includes('ogg')) return 'ogg';
      return 'webm'; // fallback
    };

    const formData = new FormData();
    formData.append('model_id', 'scribe_v1');

    const ext = getFileExtension(audioBlob.type || 'audio/webm');
    formData.append('file', audioBlob, `recording.${ext}`);

    if (languageCode) {
      formData.append('language_code', languageCode);
    }

    console.log(`[AudioCache] Transcribing audio (${(audioBlob.size / 1024).toFixed(1)}KB)...`);

    // Add timeout with AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey
        },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs STT error: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[AudioCache] Transcription complete: "${(data.text || '').slice(0, 50)}..."`);
      return data.text || '';
    } finally {
      clearTimeout(timeout);
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
    uploadToBackend,
    clearCache,
    getCacheStats,
    fetchSubscription,
    fetchSubscriptionForKey,
    refreshAllKeys,
    selectBestKey,
    generateViaAPI,
    transcribeAudio,
    cache,
    isLoading,
    lastCharacterCost
  };
}

export function useAudioCache() {
  if (!instance) {
    instance = createAudioCache();
  }
  return instance;
}
