import { ref, computed } from 'vue';
import type { HookEvent } from '../types';

// ElevenLabs configuration
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel default

// Voice notification settings
export interface VoiceSettings {
  enabled: boolean;
  volume: number; // 0-1
  voiceId: string;
  notifyOnStop: boolean;
  notifyOnError: boolean;
  notifyOnHITL: boolean;
  notifyOnSummary: boolean;
}

const defaultSettings: VoiceSettings = {
  enabled: false,
  volume: 0.8,
  voiceId: ELEVENLABS_VOICE_ID,
  notifyOnStop: true,
  notifyOnError: true,
  notifyOnHITL: true,
  notifyOnSummary: false
};

export function useVoiceNotifications() {
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
  const audioQueue = ref<string[]>([]);
  const currentAudio = ref<HTMLAudioElement | null>(null);

  const isConfigured = computed(() => !!ELEVENLABS_API_KEY);

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

  // Generate speech using ElevenLabs API
  const speak = async (text: string): Promise<void> => {
    if (!settings.value.enabled || !ELEVENLABS_API_KEY || !text) return;

    // Add to queue
    audioQueue.value.push(text);

    // If already speaking, let the queue handle it
    if (isSpeaking.value) return;

    await processQueue();
  };

  // Process audio queue
  const processQueue = async () => {
    if (audioQueue.value.length === 0) {
      isSpeaking.value = false;
      return;
    }

    isSpeaking.value = true;
    const text = audioQueue.value.shift()!;

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${settings.value.voiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY
          },
          body: JSON.stringify({
            text: text.slice(0, 500), // Limit text length
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

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audio.volume = settings.value.volume;
      currentAudio.value = audio;

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

    } catch (error) {
      console.error('Voice notification error:', error);
    }

    currentAudio.value = null;

    // Process next in queue
    await processQueue();
  };

  // Stop current playback
  const stop = () => {
    if (currentAudio.value) {
      currentAudio.value.pause();
      currentAudio.value = null;
    }
    audioQueue.value = [];
    isSpeaking.value = false;
  };

  // Notify for specific event types
  const notifyEvent = (event: HookEvent) => {
    if (!settings.value.enabled) return;

    const eventType = event.hook_event_type;

    // HITL notification
    if (settings.value.notifyOnHITL && event.humanInTheLoop) {
      speak(`Attention: ${event.humanInTheLoop.question.slice(0, 100)}`);
      return;
    }

    // Stop event (task complete)
    if (settings.value.notifyOnStop && eventType === 'Stop') {
      const summary = event.summary || 'Task completed';
      speak(summary);
      return;
    }

    // Error notification
    if (settings.value.notifyOnError) {
      const payload = event.payload || {};
      if (payload.error || payload.exit_code !== 0) {
        speak(`Error: ${payload.error || 'Command failed'}`);
        return;
      }
    }

    // Summary notification (for events with summary)
    if (settings.value.notifyOnSummary && event.summary) {
      speak(event.summary);
    }
  };

  return {
    settings,
    isConfigured,
    isSpeaking,
    updateSettings,
    toggleEnabled,
    speak,
    stop,
    notifyEvent
  };
}
