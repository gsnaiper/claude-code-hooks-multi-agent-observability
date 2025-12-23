import { ref, onUnmounted } from 'vue';

// Extend Window interface for Speech Recognition
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export function useVoiceInput() {
  const isRecording = ref(false);
  const transcript = ref('');
  const error = ref<string | null>(null);
  const isSupported = ref(false);

  let recognition: SpeechRecognition | null = null;

  // Check browser support
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  isSupported.value = !!SpeechRecognitionAPI;

  // Initialize recognition if supported
  if (SpeechRecognitionAPI) {
    recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isRecording.value = true;
      error.value = null;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results;
      if (results.length > 0) {
        const result = results[results.length - 1];
        transcript.value = result[0].transcript;
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      error.value = event.error;
      isRecording.value = false;
    };

    recognition.onend = () => {
      isRecording.value = false;
    };
  }

  // Start recording
  const startRecording = (lang: string = 'ru-RU') => {
    if (!recognition || !isSupported.value) {
      error.value = 'Speech recognition not supported';
      return;
    }

    if (isRecording.value) {
      return;
    }

    transcript.value = '';
    error.value = null;
    recognition.lang = lang;

    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start recording:', e);
      error.value = 'Failed to start recording';
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (!recognition || !isRecording.value) {
      return;
    }

    try {
      recognition.stop();
    } catch (e) {
      console.error('Failed to stop recording:', e);
    }
  };

  // Toggle recording
  const toggleRecording = (lang: string = 'ru-RU') => {
    if (isRecording.value) {
      stopRecording();
    } else {
      startRecording(lang);
    }
  };

  // Clear transcript
  const clearTranscript = () => {
    transcript.value = '';
    error.value = null;
  };

  // Cleanup on unmount
  onUnmounted(() => {
    if (recognition && isRecording.value) {
      recognition.abort();
    }
  });

  return {
    isRecording,
    transcript,
    error,
    isSupported,
    startRecording,
    stopRecording,
    toggleRecording,
    clearTranscript
  };
}
