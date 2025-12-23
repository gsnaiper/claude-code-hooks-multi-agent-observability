/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAX_EVENTS_TO_DISPLAY?: string;
  readonly VITE_ELEVENLABS_API_KEY?: string;
  readonly VITE_ELEVENLABS_VOICE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
