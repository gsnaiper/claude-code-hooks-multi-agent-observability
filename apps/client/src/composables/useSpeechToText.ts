import { ref } from 'vue';
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

export function useSpeechToText() {
  const audioCache = useAudioCache();
  const voiceNotifications = useVoiceNotifications();

  const isRecording = ref(false);
  const isTranscribing = ref(false);
  const transcript = ref('');
  const error = ref<string | null>(null);

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];

  // Determine language based on selected voice
  const getLanguageCode = (): string => {
    const voiceId = voiceNotifications.settings.value.voiceId;
    return RUSSIAN_VOICE_IDS.includes(voiceId) ? 'ru' : 'en';
  };

  // Start recording audio from microphone
  const startRecording = async (): Promise<void> => {
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

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      mediaRecorder.start();
      isRecording.value = true;
      error.value = null;

      console.log('[STT] Recording started');
    } catch (e) {
      console.error('[STT] Failed to start recording:', e);
      error.value = 'Microphone access denied';
      throw e;
    }
  };

  // Stop recording and transcribe
  const stopRecording = async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder) {
        reject(new Error('No active recording'));
        return;
      }

      mediaRecorder.onstop = async () => {
        isRecording.value = false;
        isTranscribing.value = true;

        try {
          const audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
          console.log(`[STT] Recording stopped, ${audioChunks.length} chunks, ${(audioBlob.size / 1024).toFixed(1)}KB`);

          // Get best API key for load balancing
          const apiKey = voiceNotifications.getBestApiKey();
          if (!apiKey) {
            throw new Error('No API key available');
          }

          const langCode = getLanguageCode();
          const text = await audioCache.transcribeAudio(audioBlob, langCode, apiKey);

          transcript.value = text;
          error.value = null;
          resolve(text);
        } catch (e) {
          console.error('[STT] Transcription failed:', e);
          error.value = 'Transcription failed';
          reject(e);
        } finally {
          isTranscribing.value = false;
        }
      };

      // Stop the recorder
      mediaRecorder.stop();

      // Stop all tracks to release microphone
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    });
  };

  // Cancel recording without transcribing
  const cancelRecording = () => {
    if (mediaRecorder && isRecording.value) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      isRecording.value = false;
      audioChunks = [];
      console.log('[STT] Recording cancelled');
    }
  };

  return {
    isRecording,
    isTranscribing,
    transcript,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    getLanguageCode
  };
}
