import { ref, computed } from 'vue';
import type { HookEvent } from '../types';
import { useAudioCache } from './useAudioCache';
import { playNormalized, playNormalizedUrl, stopPlayback } from './useAudioNormalizer';

// ElevenLabs configuration
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel default

// Russian voice IDs
const RUSSIAN_VOICE_IDS = [
  'XB0fDUnXU5powFXDhCwa', // Charlotte
  'onwK4e9ZLuTAKqWW03F9', // Daniel
  'N2lVS1w4EtoT3dr4eOWO', // Callum
  'pFZP5JQG7iQjIQuC4Bku', // Lily
  'bIHbv24MWmeRgasZH58o'  // Will
];

// Local audio files for standard phrases (no API call needed)
const LOCAL_AUDIO = {
  en: {
    taskComplete: '/audio/task-complete-en.mp3',
    error: '/audio/error-en.mp3',
    hitlRequest: '/audio/hitl-request-en.mp3',
    commandFailed: '/audio/command-failed-en.mp3',
    notification: '/audio/notification-en.mp3',
    commit: '/audio/commit-en.mp3'
  },
  ru: {
    taskComplete: '/audio/task-complete-ru.mp3',
    error: '/audio/error-ru.mp3',
    hitlRequest: '/audio/hitl-request-ru.mp3',
    commandFailed: '/audio/command-failed-ru.mp3',
    notification: '/audio/notification-ru.mp3',
    commit: '/audio/commit-ru.mp3'
  }
};

// Voice notification settings
export interface VoiceSettings {
  enabled: boolean;
  volume: number; // 0-1
  voiceId: string;
  notifyOnStop: boolean;
  notifyOnError: boolean;
  notifyOnHITL: boolean;
  notifyOnSummary: boolean;
  notifyOnNotification: boolean;
  notifyOnCommit: boolean;
}

// Notification history record
export interface NotificationRecord {
  id: number;
  timestamp: number;
  type: 'stop' | 'error' | 'hitl' | 'notification' | 'summary' | 'commit';
  sourceApp: string;
  sessionId: string;
  message: string;
  audioKey?: string; // For cached audio replay
}

const defaultSettings: VoiceSettings = {
  enabled: false,
  volume: 0.8,
  voiceId: ELEVENLABS_VOICE_ID,
  notifyOnStop: true,
  notifyOnError: true,
  notifyOnHITL: true,
  notifyOnSummary: false,
  notifyOnNotification: true,
  notifyOnCommit: true
};

const MAX_HISTORY = 20;
let notificationIdCounter = 0;

// Notification queue to prevent parallel playback
const notificationQueue: HookEvent[] = [];
let isProcessingQueue = false;

// Debounce tracking for template audio (avoid repeating same project)
const TEMPLATE_DEBOUNCE_MS = 10000; // 10 seconds
let lastTemplateProject: string | null = null;
let lastTemplateTime = 0;

// Singleton instance
let instance: ReturnType<typeof createVoiceNotifications> | null = null;

function createVoiceNotifications() {
  // Audio cache for project names
  const audioCache = useAudioCache();

  // Load settings from localStorage
  const loadSettings = (): VoiceSettings => {
    try {
      const saved = localStorage.getItem('voiceSettings');
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Failed to load voice settings:', e);
    }
    return defaultSettings;
  };

  const settings = ref<VoiceSettings>(loadSettings());
  const isSpeaking = ref(false);
  const notificationHistory = ref<NotificationRecord[]>([]);

  // Subscription state
  const subscription = ref<{
    characterCount: number;
    characterLimit: number;
    nextResetUnix: number | null;
    tier: string;
    status: string;
  } | null>(null);
  const isLoadingSubscription = ref(false);

  const isConfigured = computed(() => !!ELEVENLABS_API_KEY);

  // Fetch subscription info
  const refreshSubscription = async () => {
    if (!ELEVENLABS_API_KEY || isLoadingSubscription.value) return;

    isLoadingSubscription.value = true;
    try {
      const data = await audioCache.fetchSubscription();
      if (data) {
        subscription.value = data;
      }
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
    } finally {
      isLoadingSubscription.value = false;
    }
  };

  // Initialize audio cache and subscription on startup
  audioCache.loadCache().catch(console.error);
  if (ELEVENLABS_API_KEY) {
    refreshSubscription();
  }

  // Save settings to localStorage
  const saveSettings = () => {
    try {
      localStorage.setItem('voiceSettings', JSON.stringify(settings.value));
    } catch (e) {
      console.warn('Failed to save voice settings:', e);
    }
  };

  // Update settings
  const updateSettings = (newSettings: Partial<VoiceSettings>) => {
    settings.value = { ...settings.value, ...newSettings };
    saveSettings();
  };

  // Toggle voice notifications
  const toggleEnabled = () => {
    settings.value.enabled = !settings.value.enabled;
    saveSettings();
  };

  // Get current language based on voice selection
  const isRussianVoice = () => RUSSIAN_VOICE_IDS.includes(settings.value.voiceId);
  const getLocalAudio = () => isRussianVoice() ? LOCAL_AUDIO.ru : LOCAL_AUDIO.en;

  // Check if template audio should be played (debounce same project)
  const shouldPlayTemplate = (sourceApp: string): boolean => {
    const now = Date.now();
    if (lastTemplateProject === sourceApp && (now - lastTemplateTime) < TEMPLATE_DEBOUNCE_MS) {
      return false; // Skip template - same project recently played
    }
    lastTemplateProject = sourceApp;
    lastTemplateTime = now;
    return true;
  };

  // Extract commit message from git commit command
  const extractCommitMessage = (command: string): string | null => {
    // Pattern 1: HEREDOC style (check first - more specific)
    // git commit -m "$(cat <<'EOF'\n message \n EOF)"
    const heredocMatch = command.match(/git commit.*-m\s*"\$\(cat\s*<<['"]?EOF['"]?\s*\n([\s\S]*?)\n\s*EOF/);
    if (heredocMatch) {
      // Get first non-empty line as commit message
      const lines = heredocMatch[1].split('\n').map(l => l.trim()).filter(l => l);
      return lines[0] || null;
    }

    // Pattern 2: Simple -m "message" (no HEREDOC)
    // Must NOT contain $( to avoid partial HEREDOC match
    const simpleMatch = command.match(/git commit[^$]*-m\s*["']([^"'$]+)["']/);
    if (simpleMatch) return simpleMatch[1];

    return null;
  };

  // Play audio blob with volume normalization
  const playBlob = async (blob: Blob): Promise<void> => {
    await playNormalized(blob, settings.value.volume);
  };

  // Play local audio file with volume normalization
  const playLocalAudio = async (audioPath: string): Promise<void> => {
    if (!settings.value.enabled) return;

    isSpeaking.value = true;

    try {
      await playNormalizedUrl(audioPath, settings.value.volume);
    } catch (error) {
      console.error('Local audio playback error:', error);
    }

    isSpeaking.value = false;
  };

  // Generate and play speech using ElevenLabs API (no caching)
  const speak = async (text: string): Promise<void> => {
    if (!settings.value.enabled || !ELEVENLABS_API_KEY || !text) return;

    isSpeaking.value = true;

    try {
      const result = await audioCache.generateWithoutCache(text, settings.value.voiceId);
      await playBlob(result.blob);
    } catch (error) {
      console.error('Voice notification error:', error);
    }

    isSpeaking.value = false;
  };

  // Get or generate cached audio for project name
  const getProjectAudio = async (sourceApp: string): Promise<Blob | null> => {
    if (!ELEVENLABS_API_KEY) return null;

    const key = `project:${sourceApp}`;
    const text = isRussianVoice() ? `Проект ${sourceApp}` : `Project ${sourceApp}`;

    try {
      return await audioCache.getOrGenerate(key, text, settings.value.voiceId);
    } catch (error) {
      console.error('Failed to get project audio:', error);
      return null;
    }
  };

  // Add notification to history
  const addToHistory = (record: Omit<NotificationRecord, 'id'>) => {
    const newRecord: NotificationRecord = {
      ...record,
      id: notificationIdCounter++
    };
    notificationHistory.value.unshift(newRecord);
    if (notificationHistory.value.length > MAX_HISTORY) {
      notificationHistory.value.pop();
    }
  };

  // Replay notification from history
  const replayNotification = async (record: NotificationRecord) => {
    if (!settings.value.enabled) return;

    isSpeaking.value = true;

    try {
      // If we have a cached audio key, try to play from cache
      if (record.audioKey) {
        const cached = audioCache.getFromCache(record.audioKey);
        if (cached) {
          await playBlob(cached);
          isSpeaking.value = false;
          return;
        }
      }

      // Otherwise generate via API
      if (record.message) {
        await speak(record.message);
      }
    } catch (error) {
      console.error('Replay error:', error);
    }

    isSpeaking.value = false;
  };

  // Clear notification history
  const clearHistory = () => {
    notificationHistory.value = [];
  };

  // Stop current playback
  const stop = () => {
    stopPlayback();
    isSpeaking.value = false;
  };

  // Process a single notification event (internal)
  const processEvent = async (event: HookEvent) => {
    if (!settings.value.enabled) return;

    const eventType = event.hook_event_type;
    const localAudio = getLocalAudio();
    const sourceApp = event.source_app || 'unknown';
    const sessionId = event.session_id || '';

    // HITL notification (local audio + dynamic question/choices)
    if (settings.value.notifyOnHITL && event.humanInTheLoop) {
      isSpeaking.value = true;
      const hitl = event.humanInTheLoop;
      const playTemplate = shouldPlayTemplate(sourceApp);

      // 1. Play local HITL sound (if not debounced)
      if (playTemplate) {
        await playLocalAudio(localAudio.hitlRequest);
      }

      // 2. Build dynamic message with question and choices
      if (ELEVENLABS_API_KEY) {
        let dynamicText = '';

        // Add question
        if (hitl.question) {
          dynamicText = hitl.question;
        }

        // Add choices if available
        if (hitl.type === 'choice' && hitl.choices && hitl.choices.length > 0) {
          const choicesText = hitl.choices
            .map((c, i) => `${i + 1}: ${c}`)
            .join('. ');
          dynamicText += isRussianVoice()
            ? `. Варианты: ${choicesText}`
            : `. Options: ${choicesText}`;
        }

        // Speak the dynamic content
        if (dynamicText) {
          try {
            const result = await audioCache.generateWithoutCache(dynamicText, settings.value.voiceId, sourceApp);
            await playBlob(result.blob);
          } catch (error) {
            console.error('HITL audio error:', error);
          }
        }
      }

      // Add to history
      addToHistory({
        timestamp: Date.now(),
        type: 'hitl',
        sourceApp,
        sessionId,
        message: hitl.question || (isRussianVoice()
          ? `${sourceApp}: Требуется ваш ввод`
          : `${sourceApp}: Human input required`)
      });

      isSpeaking.value = false;
      return;
    }

    // Git commit notification
    if (settings.value.notifyOnCommit && eventType === 'PostToolUse') {
      const toolName = event.payload?.tool_name;
      const command = event.payload?.tool_input?.command || '';

      if (toolName === 'Bash' && command.includes('git commit')) {
        const commitMsg = extractCommitMessage(command);
        isSpeaking.value = true;

        const playTemplate = shouldPlayTemplate(sourceApp);

        // 1. Play local "commit" sound (if not debounced)
        if (playTemplate) {
          await playLocalAudio(localAudio.commit);
        }

        // 2. Speak commit message (first line, no truncation) - always play dynamic content
        if (commitMsg && ELEVENLABS_API_KEY) {
          // First line already extracted by extractCommitMessage, read full line
          const text = `Commit: ${commitMsg}`;
          try {
            const result = await audioCache.generateWithoutCache(text, settings.value.voiceId, sourceApp);
            await playBlob(result.blob);
          } catch (error) {
            console.error('Commit audio error:', error);
          }
        }

        // Add to history
        addToHistory({
          timestamp: Date.now(),
          type: 'commit',
          sourceApp,
          sessionId,
          message: commitMsg || 'git commit'
        });

        isSpeaking.value = false;
        return;
      }
    }

    // Stop event - task complete with project context
    if (settings.value.notifyOnStop && eventType === 'Stop') {
      isSpeaking.value = true;

      const playTemplate = shouldPlayTemplate(sourceApp);

      // 1. Start fetching project audio (cached or API) in parallel - only if playing template
      const projectAudioPromise = playTemplate ? getProjectAudio(sourceApp) : null;

      // 2. Start fetching dynamic summary in parallel (if exists) - always fetch dynamic
      let dynamicAudioPromise: ReturnType<typeof audioCache.generateWithoutCache> | null = null;
      if (event.summary && ELEVENLABS_API_KEY) {
        dynamicAudioPromise = audioCache.generateWithoutCache(event.summary, settings.value.voiceId, sourceApp);
      }

      // 3. Play local "task complete" sound first (if not debounced)
      if (playTemplate) {
        await playLocalAudio(localAudio.taskComplete);

        // 4. Play cached project name
        const projectAudio = await projectAudioPromise;
        if (projectAudio) {
          await playBlob(projectAudio);
        }
      }

      // 5. Play dynamic summary (always play dynamic content)
      if (dynamicAudioPromise) {
        try {
          const result = await dynamicAudioPromise;
          await playBlob(result.blob);
        } catch (error) {
          console.error('Dynamic audio error:', error);
        }
      }

      // Add to history
      addToHistory({
        timestamp: Date.now(),
        type: 'stop',
        sourceApp,
        sessionId,
        message: event.summary || (isRussianVoice() ? 'Задача завершена' : 'Task complete'),
        audioKey: `project:${sourceApp}`
      });

      isSpeaking.value = false;
      return;
    }

    // Notification event
    if (settings.value.notifyOnNotification && eventType === 'Notification') {
      isSpeaking.value = true;

      const playTemplate = shouldPlayTemplate(sourceApp);

      // 1. Start fetching project audio in parallel - only if playing template
      const projectAudioPromise = playTemplate ? getProjectAudio(sourceApp) : null;

      // 2. Start fetching summary in parallel - always fetch dynamic
      let dynamicAudioPromise: ReturnType<typeof audioCache.generateWithoutCache> | null = null;
      if (event.summary && ELEVENLABS_API_KEY) {
        dynamicAudioPromise = audioCache.generateWithoutCache(event.summary, settings.value.voiceId, sourceApp);
      }

      // 3. Play local notification sound (if not debounced)
      if (playTemplate) {
        await playLocalAudio(localAudio.notification);

        // 4. Play cached project name
        const projectAudio = await projectAudioPromise;
        if (projectAudio) {
          await playBlob(projectAudio);
        }
      }

      // 5. Play dynamic content (always)
      if (dynamicAudioPromise) {
        try {
          const result = await dynamicAudioPromise;
          await playBlob(result.blob);
        } catch (error) {
          console.error('Dynamic audio error:', error);
        }
      }

      // Add to history
      addToHistory({
        timestamp: Date.now(),
        type: 'notification',
        sourceApp,
        sessionId,
        message: event.summary || (isRussianVoice() ? 'Уведомление' : 'Notification'),
        audioKey: `project:${sourceApp}`
      });

      isSpeaking.value = false;
      return;
    }

    // Error notification (local audio)
    if (settings.value.notifyOnError) {
      const payload = event.payload || {};
      if (payload.error || payload.exit_code !== 0) {
        await playLocalAudio(localAudio.error);

        // Add to history
        addToHistory({
          timestamp: Date.now(),
          type: 'error',
          sourceApp,
          sessionId,
          message: isRussianVoice() ? `${sourceApp}: Ошибка` : `${sourceApp}: Error`
        });
        return;
      }
    }

    // Summary notification - uses API for dynamic text
    if (settings.value.notifyOnSummary && event.summary) {
      await speak(event.summary);

      // Add to history
      addToHistory({
        timestamp: Date.now(),
        type: 'summary',
        sourceApp,
        sessionId,
        message: event.summary
      });
    }
  };

  // Process queue sequentially to prevent audio overlap
  const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (notificationQueue.length > 0) {
      const event = notificationQueue.shift();
      if (event) {
        try {
          await processEvent(event);
        } catch (error) {
          console.error('Error processing notification:', error);
        }
      }
    }

    isProcessingQueue = false;
  };

  // Public method to queue and process notifications
  const notifyEvent = (event: HookEvent) => {
    notificationQueue.push(event);
    processQueue();
  };

  return {
    settings,
    isConfigured,
    isSpeaking,
    notificationHistory,
    subscription,
    isLoadingSubscription,
    updateSettings,
    toggleEnabled,
    speak,
    playLocalAudio,
    playBlob,
    stop,
    notifyEvent,
    getLocalAudio,
    addToHistory,
    replayNotification,
    clearHistory,
    refreshSubscription,
    audioCache
  };
}

export function useVoiceNotifications() {
  if (!instance) {
    instance = createVoiceNotifications();
  }
  return instance;
}
