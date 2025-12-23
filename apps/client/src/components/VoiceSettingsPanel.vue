<template>
  <Teleport to="body">
    <Transition name="slide">
      <div
        v-if="isOpen"
        class="fixed right-0 top-0 h-full w-80 bg-[var(--theme-bg-primary)] shadow-2xl z-50 flex flex-col border-l border-[var(--theme-border)]"
      >
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
          <h2 class="text-lg font-bold text-[var(--theme-text-primary)] flex items-center gap-2">
            🔔 Voice Settings
          </h2>
          <button
            @click="$emit('close')"
            class="p-2 rounded-lg hover:bg-[var(--theme-bg-tertiary)] transition-colors"
          >
            <span class="text-xl">✕</span>
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-4 space-y-6">
          <!-- Master Toggle -->
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border)]">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold text-[var(--theme-text-primary)]">Voice Notifications</h3>
                <p class="text-sm text-[var(--theme-text-secondary)]">Enable/disable all voice alerts</p>
              </div>
              <button
                @click="toggleEnabled"
                class="relative w-14 h-7 rounded-full transition-colors duration-200"
                :class="settings.enabled ? 'bg-green-500' : 'bg-gray-400'"
              >
                <span
                  class="absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                  :class="settings.enabled ? 'translate-x-8' : 'translate-x-1'"
                ></span>
              </button>
            </div>
          </div>

          <!-- Volume -->
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border)]">
            <h3 class="font-semibold text-[var(--theme-text-primary)] mb-3">🔊 Volume</h3>
            <div class="flex items-center gap-3">
              <span class="text-sm">🔈</span>
              <input
                type="range"
                min="0"
                max="100"
                :value="settings.volume * 100"
                @input="updateVolume(($event.target as HTMLInputElement).value)"
                class="flex-1 h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-[var(--theme-primary)]"
              />
              <span class="text-sm">🔊</span>
              <span class="text-sm text-[var(--theme-text-secondary)] w-10">{{ Math.round(settings.volume * 100) }}%</span>
            </div>
          </div>

          <!-- Notification Triggers -->
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border)]">
            <h3 class="font-semibold text-[var(--theme-text-primary)] mb-3">🎯 Notify On</h3>
            <div class="space-y-3">
              <!-- Stop Events -->
              <label class="flex items-center justify-between cursor-pointer">
                <div class="flex items-center gap-2">
                  <span>✅</span>
                  <span class="text-[var(--theme-text-primary)]">Task Complete</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.notifyOnStop"
                  @change="updateSetting('notifyOnStop', ($event.target as HTMLInputElement).checked)"
                  class="w-5 h-5 rounded accent-[var(--theme-primary)]"
                />
              </label>

              <!-- Errors -->
              <label class="flex items-center justify-between cursor-pointer">
                <div class="flex items-center gap-2">
                  <span>❌</span>
                  <span class="text-[var(--theme-text-primary)]">Errors</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.notifyOnError"
                  @change="updateSetting('notifyOnError', ($event.target as HTMLInputElement).checked)"
                  class="w-5 h-5 rounded accent-[var(--theme-primary)]"
                />
              </label>

              <!-- HITL -->
              <label class="flex items-center justify-between cursor-pointer">
                <div class="flex items-center gap-2">
                  <span>🙋</span>
                  <span class="text-[var(--theme-text-primary)]">Human Input Needed</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.notifyOnHITL"
                  @change="updateSetting('notifyOnHITL', ($event.target as HTMLInputElement).checked)"
                  class="w-5 h-5 rounded accent-[var(--theme-primary)]"
                />
              </label>

              <!-- All Summaries -->
              <label class="flex items-center justify-between cursor-pointer">
                <div class="flex items-center gap-2">
                  <span>📢</span>
                  <span class="text-[var(--theme-text-primary)]">All Summaries</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.notifyOnSummary"
                  @change="updateSetting('notifyOnSummary', ($event.target as HTMLInputElement).checked)"
                  class="w-5 h-5 rounded accent-[var(--theme-primary)]"
                />
              </label>
            </div>
          </div>

          <!-- Voice Selection -->
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border)]">
            <h3 class="font-semibold text-[var(--theme-text-primary)] mb-3">🎤 Voice</h3>
            <select
              :value="settings.voiceId"
              @change="updateSetting('voiceId', ($event.target as HTMLSelectElement).value)"
              class="w-full p-2 rounded-lg bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)] border border-[var(--theme-border)]"
            >
              <optgroup label="🇷🇺 Русские голоса">
                <option value="XB0fDUnXU5powFXDhCwa">Charlotte (Женский, RU)</option>
                <option value="onwK4e9ZLuTAKqWW03F9">Daniel (Мужской, RU)</option>
                <option value="N2lVS1w4EtoT3dr4eOWO">Callum (Мужской, RU)</option>
                <option value="pFZP5JQG7iQjIQuC4Bku">Lily (Женский, RU)</option>
                <option value="bIHbv24MWmeRgasZH58o">Will (Мужской, RU)</option>
              </optgroup>
              <optgroup label="🇬🇧 English Voices">
                <option value="21m00Tcm4TlvDq8ikWAM">Rachel (Female)</option>
                <option value="pNInz6obpgDQGcFmaJgB">Adam (Male)</option>
                <option value="TxGEqnHWrfWFTfGW9XjX">Josh (Male)</option>
                <option value="EXAVITQu4vr4xnSDxMaL">Bella (Female)</option>
                <option value="MF3mGyEYCl7XYWbV9V6O">Elli (Female)</option>
                <option value="yoZ06aMxZJJ28mfd3POQ">Sam (Male)</option>
              </optgroup>
            </select>
          </div>

          <!-- Test Button -->
          <button
            @click="testVoice"
            :disabled="!settings.enabled || isSpeaking"
            class="w-full py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2"
            :class="settings.enabled && !isSpeaking
              ? 'bg-[var(--theme-primary)] text-white hover:bg-[var(--theme-primary-dark)]'
              : 'bg-gray-400 text-gray-200 cursor-not-allowed'"
          >
            <span>{{ isSpeaking ? '🔊' : '🔔' }}</span>
            {{ isSpeaking ? 'Speaking...' : 'Test Voice' }}
          </button>
        </div>

        <!-- Footer -->
        <div class="p-4 border-t border-[var(--theme-border)] bg-[var(--theme-bg-secondary)]">
          <p class="text-xs text-[var(--theme-text-secondary)] text-center">
            Powered by ElevenLabs
          </p>
        </div>
      </div>
    </Transition>

    <!-- Backdrop -->
    <Transition name="fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 bg-black/50 z-40"
        @click="$emit('close')"
      ></div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { VoiceSettings } from '../composables/useVoiceNotifications';

const props = defineProps<{
  isOpen: boolean;
  settings: VoiceSettings;
  isSpeaking: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'update:settings': [settings: Partial<VoiceSettings>];
  toggleEnabled: [];
  testVoice: [];
}>();

const toggleEnabled = () => {
  emit('toggleEnabled');
};

const updateSetting = (key: keyof VoiceSettings, value: any) => {
  emit('update:settings', { [key]: value });
};

const updateVolume = (value: string) => {
  emit('update:settings', { volume: parseInt(value) / 100 });
};

const testVoice = () => {
  emit('testVoice');
};
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
