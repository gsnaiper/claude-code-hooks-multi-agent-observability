import { ref, onUnmounted } from 'vue';
import { useAudioCache } from './useAudioCache';
import { useVoiceNotifications } from './useVoiceNotifications';

// Russian voice IDs for language detection
const RUSSIAN_VOICE_IDS = [
  'XB0fDUnXU5powFXDhCwa', // Charlotte
  'onwK4e9ZLuTAKqWW03F9', // Daniel
  'N2lVS1w4EtoT3dr4eOWO', // Callum
  'pFZP5JQG7iQjIQuC4Bku', // Lily
  'bIHbv24MWmeRgasZH58o'  // Will
];

// Maximum audio size in bytes (25MB)
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB

export function useVoiceInput() {
  const audioCache = useAudioCache();
  const voiceNotifications = useVoiceNotifications();

  const isRecording = ref(false);
  const isTranscribing = ref(false);
  const transcript = ref('');
  const error = ref<string | null>(null);
  const isSupported = ref(true); // ElevenLabs API is always "supported"
  const recordingLanguage = ref<string>('ru-RU');

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let currentAudioSize = 0;

  // Determine language based on selected voice or explicit lang param
  const getLanguageCode = (lang?: string): string => {
    if (lang) {
      // Map common locale codes to ElevenLabs language codes
      if (lang.startsWith('ru')) return 'ru';
      if (lang.startsWith('en')) return 'en';
      return lang.split('-')[0];
    }
    // Fall back to voice-based detection
    const voiceId = voiceNotifications.settings.value.voiceId;
    return RUSSIAN_VOICE_IDS.includes(voiceId) ? 'ru' : 'en';
  };

  // Start recording audio from microphone
  const startRecording = async (lang: string = 'ru-RU') => {
    if (isRecording.value) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Try to use webm, fall back to other formats
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/ogg';

      mediaRecorder = new MediaRecorder(stream, { mimeType });
      audioChunks = [];
      currentAudioSize = 0;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          currentAudioSize += e.data.size;
          if (currentAudioSize > MAX_AUDIO_SIZE) {
            console.warn('[VoiceInput] Recording too large, auto-stopping');
            error.value = 'Recording too long, please try again';
            mediaRecorder?.stop();
            return;
          }
          audioChunks.push(e.data);
        }
      };

      // Store lang for later use
      recordingLanguage.value = lang;

      mediaRecorder.start();
      isRecording.value = true;
      error.value = null;
      transcript.value = '';

      console.log('[VoiceInput] Recording started (ElevenLabs STT)');
    } catch (e) {
      console.error('[VoiceInput] Failed to start recording:', e);
      error.value = 'Microphone access denied';
    }
  };

  // Stop recording and transcribe via ElevenLabs
  const stopRecording = async () => {
    if (!mediaRecorder || !isRecording.value) return;

    return new Promise<void>((resolve) => {
      mediaRecorder!.onstop = async () => {
        isRecording.value = false;
        isTranscribing.value = true;

        try {
          const audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
          console.log(`[VoiceInput] Recording stopped, ${(audioBlob.size / 1024).toFixed(1)}KB`);

          // Get best API key for load balancing
          const apiKey = voiceNotifications.getBestApiKey();
          if (!apiKey) {
            throw new Error('No ElevenLabs API key available');
          }

          const lang = recordingLanguage.value;
          const langCode = getLanguageCode(lang);

          const text = await audioCache.transcribeAudio(audioBlob, langCode, apiKey);
          transcript.value = text;
          error.value = null;

          console.log(`[VoiceInput] Transcription: "${text}"`);
        } catch (e) {
          console.error('[VoiceInput] Transcription failed:', e);
          error.value = 'Transcription failed';
        } finally {
          isTranscribing.value = false;
          resolve();
        }
      };

      // Stop the recorder
      mediaRecorder!.stop();

      // Stop all tracks to release microphone
      mediaRecorder!.stream.getTracks().forEach(track => track.stop());
    });
  };

  // Toggle recording
  const toggleRecording = async (lang: string = 'ru-RU') => {
    if (isRecording.value) {
      await stopRecording();
    } else {
      await startRecording(lang);
    }
  };

  // Clear transcript
  const clearTranscript = () => {
    transcript.value = '';
    error.value = null;
  };

  // Cleanup on unmount
  onUnmounted(() => {
    if (mediaRecorder && isRecording.value) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
  });

  return {
    isRecording,
    isTranscribing,
    transcript,
    error,
    isSupported,
    startRecording,
    stopRecording,
    toggleRecording,
    clearTranscript
  };
}
