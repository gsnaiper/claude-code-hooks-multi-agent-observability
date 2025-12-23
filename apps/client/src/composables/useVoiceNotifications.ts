import { ref, computed } from 'vue';
import type { HookEvent } from '../types';
import { useAudioCache } from './useAudioCache';

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
  const currentAudio = ref<HTMLAudioElement | null>(null);
  const notificationHistory = ref<NotificationRecord[]>([]);

  const isConfigured = computed(() => !!ELEVENLABS_API_KEY);

  // Initialize audio cache on startup
  audioCache.loadCache().catch(console.error);

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

  // Extract commit message from git commit command
  const extractCommitMessage = (command: string): string | null => {
    // Pattern 1: git commit -m "message" or git commit -m 'message'
    const match1 = command.match(/git commit[^"']*-m\s*["']([^"']+)["']/);
    if (match1) return match1[1];

    // Pattern 2: HEREDOC style - git commit -m "$(cat <<'EOF'\nmessage\nEOF\n)"
    const match2 = command.match(/git commit.*\$\(cat\s*<<['"]?EOF['"]?\s*\n([\s\S]*?)\n\s*EOF/);
    if (match2) return match2[1].split('\n')[0].trim(); // First line only

    return null;
  };

  // Play audio blob
  const playBlob = async (blob: Blob): Promise<void> => {
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audio.volume = settings.value.volume;
    currentAudio.value = audio;

    try {
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audioUrl);
          reject(new Error('Audio playback failed'));
        };
        audio.play().catch(reject);
      });
    } finally {
      currentAudio.value = null;
    }
  };

  // Play local audio file (instant, no API call)
  const playLocalAudio = async (audioPath: string): Promise<void> => {
    if (!settings.value.enabled) return;

    isSpeaking.value = true;

    try {
      const audio = new Audio(audioPath);
      audio.volume = settings.value.volume;
      currentAudio.value = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error('Audio playback failed'));
        audio.play().catch(reject);
      });
    } catch (error) {
      console.error('Local audio playback error:', error);
    }

    currentAudio.value = null;
    isSpeaking.value = false;
  };

  // Generate and play speech using ElevenLabs API (no caching)
  const speak = async (text: string): Promise<void> => {
    if (!settings.value.enabled || !ELEVENLABS_API_KEY || !text) return;

    isSpeaking.value = true;

    try {
      const blob = await audioCache.generateWithoutCache(text, settings.value.voiceId);
      await playBlob(blob);
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
    if (currentAudio.value) {
      currentAudio.value.pause();
      currentAudio.value = null;
    }
    isSpeaking.value = false;
  };

  // Notify for specific event types with project context
  const notifyEvent = async (event: HookEvent) => {
    if (!settings.value.enabled) return;

    const eventType = event.hook_event_type;
    const localAudio = getLocalAudio();
    const sourceApp = event.source_app || 'unknown';
    const sessionId = event.session_id || '';

    // HITL notification (local audio)
    if (settings.value.notifyOnHITL && event.humanInTheLoop) {
      await playLocalAudio(localAudio.hitlRequest);

      // Add to history
      addToHistory({
        timestamp: Date.now(),
        type: 'hitl',
        sourceApp,
        sessionId,
        message: isRussianVoice()
          ? `${sourceApp}: Требуется ваш ввод`
          : `${sourceApp}: Human input required`
      });
      return;
    }

    // Git commit notification
    if (settings.value.notifyOnCommit && eventType === 'PostToolUse') {
      const toolName = event.payload?.tool_name;
      const command = event.payload?.tool_input?.command || '';

      if (toolName === 'Bash' && command.includes('git commit')) {
        const commitMsg = extractCommitMessage(command);
        isSpeaking.value = true;

        // 1. Play local "commit" sound
        await playLocalAudio(localAudio.commit);

        // 2. Speak brief commit info (if message extracted)
        if (commitMsg && ELEVENLABS_API_KEY) {
          const brief = commitMsg.slice(0, 60); // First 60 chars max
          const text = isRussianVoice() ? `Commit: ${brief}` : `Commit: ${brief}`;
          try {
            const blob = await audioCache.generateWithoutCache(text, settings.value.voiceId);
            await playBlob(blob);
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

      // 1. Start fetching project audio (cached or API) in parallel
      const projectAudioPromise = getProjectAudio(sourceApp);

      // 2. Start fetching dynamic summary in parallel (if exists)
      let dynamicAudioPromise: Promise<Blob> | null = null;
      if (event.summary && ELEVENLABS_API_KEY) {
        dynamicAudioPromise = audioCache.generateWithoutCache(event.summary, settings.value.voiceId);
      }

      // 3. Play local "task complete" sound first
      await playLocalAudio(localAudio.taskComplete);

      // 4. Play cached project name
      const projectAudio = await projectAudioPromise;
      if (projectAudio) {
        await playBlob(projectAudio);
      }

      // 5. Play dynamic summary (should be ready by now)
      if (dynamicAudioPromise) {
        try {
          const dynamicAudio = await dynamicAudioPromise;
          await playBlob(dynamicAudio);
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

      // 1. Start fetching project audio in parallel
      const projectAudioPromise = getProjectAudio(sourceApp);

      // 2. Start fetching summary in parallel
      let dynamicAudioPromise: Promise<Blob> | null = null;
      if (event.summary && ELEVENLABS_API_KEY) {
        dynamicAudioPromise = audioCache.generateWithoutCache(event.summary, settings.value.voiceId);
      }

      // 3. Play local notification sound
      await playLocalAudio(localAudio.notification);

      // 4. Play cached project name
      const projectAudio = await projectAudioPromise;
      if (projectAudio) {
        await playBlob(projectAudio);
      }

      // 5. Play dynamic content
      if (dynamicAudioPromise) {
        try {
          const dynamicAudio = await dynamicAudioPromise;
          await playBlob(dynamicAudio);
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

  return {
    settings,
    isConfigured,
    isSpeaking,
    notificationHistory,
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
    audioCache
  };
}

export function useVoiceNotifications() {
  if (!instance) {
    instance = createVoiceNotifications();
  }
  return instance;
}
