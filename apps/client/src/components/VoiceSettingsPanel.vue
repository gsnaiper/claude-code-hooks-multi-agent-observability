<template>
  <Teleport to="body">
    <Transition name="slide">
      <div
        v-if="isOpen"
        class="fixed right-0 top-0 h-full w-96 bg-[var(--theme-bg-primary)] shadow-2xl z-50 flex flex-col border-l border-[var(--theme-border)]"
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
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
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

              <!-- Notifications -->
              <label class="flex items-center justify-between cursor-pointer">
                <div class="flex items-center gap-2">
                  <span>🔔</span>
                  <span class="text-[var(--theme-text-primary)]">Notifications</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.notifyOnNotification"
                  @change="updateSetting('notifyOnNotification', ($event.target as HTMLInputElement).checked)"
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

              <!-- Git Commits -->
              <label class="flex items-center justify-between cursor-pointer">
                <div class="flex items-center gap-2">
                  <span>📝</span>
                  <span class="text-[var(--theme-text-primary)]">Git Commits</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.notifyOnCommit"
                  @change="updateSetting('notifyOnCommit', ($event.target as HTMLInputElement).checked)"
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

          <!-- Notification History -->
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border)]">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-[var(--theme-text-primary)]">📜 Recent Notifications</h3>
              <div class="flex gap-2">
                <button
                  v-if="notificationHistory.length > 0"
                  @click="$emit('clear-history')"
                  class="text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  title="Clear history"
                >
                  🗑️
                </button>
                <button
                  @click="$emit('clear-cache')"
                  class="text-xs px-2 py-1 rounded bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors"
                  title="Clear audio cache"
                >
                  💾
                </button>
              </div>
            </div>

            <div v-if="notificationHistory.length === 0" class="text-sm text-[var(--theme-text-secondary)] text-center py-4">
              No notifications yet
            </div>

            <div v-else class="space-y-2 max-h-48 overflow-y-auto">
              <div
                v-for="record in notificationHistory"
                :key="record.id"
                class="flex items-center gap-2 p-2 rounded-lg bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border)]"
              >
                <!-- Type Icon -->
                <span class="text-lg flex-shrink-0">{{ getTypeIcon(record.type) }}</span>

                <!-- Content -->
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-semibold text-[var(--theme-text-primary)] truncate">
                    {{ record.sourceApp }}
                  </div>
                  <div class="text-xs text-[var(--theme-text-secondary)] truncate">
                    {{ record.message }}
                  </div>
                  <div class="text-xs text-[var(--theme-text-tertiary)]">
                    {{ formatTime(record.timestamp) }}
                  </div>
                </div>

                <!-- Replay Button -->
                <button
                  @click="$emit('replay', record)"
                  :disabled="!settings.enabled || isSpeaking"
                  class="p-1.5 rounded-lg transition-colors flex-shrink-0"
                  :class="settings.enabled && !isSpeaking
                    ? 'bg-[var(--theme-primary)]/20 text-[var(--theme-primary)] hover:bg-[var(--theme-primary)]/30'
                    : 'bg-gray-400/20 text-gray-400 cursor-not-allowed'"
                  title="Replay"
                >
                  🔄
                </button>
              </div>
            </div>
          </div>

          <!-- API Keys Management -->
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border)]">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-[var(--theme-text-primary)]">🔑 API Keys</h3>
              <div class="flex gap-2">
                <button
                  @click="$emit('refresh-api-keys')"
                  :disabled="isRefreshingKeys"
                  class="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                  :class="isRefreshingKeys ? 'opacity-50 cursor-not-allowed' : ''"
                  title="Refresh all keys"
                >
                  {{ isRefreshingKeys ? '⏳' : '🔄' }}
                </button>
                <button
                  @click="showAddKeyModal = true"
                  class="text-xs px-2 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
                  title="Add new key"
                >
                  ➕
                </button>
              </div>
            </div>

            <!-- Total Usage Summary -->
            <div v-if="apiKeys.length > 0" class="mb-3 p-2 rounded-lg bg-[var(--theme-bg-tertiary)]">
              <div class="flex items-center gap-2 mb-1">
                <div class="flex-1 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full overflow-hidden">
                  <div
                    class="h-full transition-all duration-300"
                    :class="totalUsage.percent > 90 ? 'bg-red-500' : totalUsage.percent > 70 ? 'bg-yellow-500' : 'bg-green-500'"
                    :style="{ width: totalUsage.percent + '%' }"
                  ></div>
                </div>
                <span class="text-xs text-[var(--theme-text-secondary)] font-medium">{{ totalUsage.percent }}%</span>
              </div>
              <p class="text-xs text-[var(--theme-text-tertiary)]">
                Total: {{ formatNumber(totalUsage.used) }} / {{ formatNumber(totalUsage.limit) }} chars ({{ apiKeys.filter(k => k.isActive).length }} active)
              </p>
            </div>

            <!-- Keys List -->
            <div v-if="apiKeys.length === 0" class="text-sm text-[var(--theme-text-secondary)] text-center py-4">
              No API keys configured
            </div>

            <div v-else class="space-y-2 max-h-64 overflow-y-auto">
              <div
                v-for="keyInfo in apiKeys"
                :key="keyInfo.key"
                class="p-2 rounded-lg border transition-all duration-200"
                :class="keyInfo.isActive
                  ? 'bg-[var(--theme-bg-tertiary)] border-[var(--theme-border)]'
                  : 'bg-gray-500/10 border-gray-500/20 opacity-60'"
              >
                <!-- Key Header -->
                <div class="flex items-center gap-2 mb-1">
                  <button
                    @click="$emit('toggle-api-key', keyInfo.key)"
                    class="w-8 h-4 rounded-full transition-colors duration-200"
                    :class="keyInfo.isActive ? 'bg-green-500' : 'bg-gray-400'"
                  >
                    <span
                      class="block w-3 h-3 bg-white rounded-full shadow transition-transform duration-200"
                      :class="keyInfo.isActive ? 'translate-x-4' : 'translate-x-0.5'"
                    ></span>
                  </button>
                  <span class="font-medium text-sm text-[var(--theme-text-primary)]">{{ keyInfo.label }}</span>
                  <span class="flex-1 text-xs text-[var(--theme-text-tertiary)] font-mono truncate">{{ maskKey(keyInfo.key) }}</span>
                  <button
                    @click="$emit('remove-api-key', keyInfo.key)"
                    class="p-1 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                    title="Remove key"
                  >
                    🗑️
                  </button>
                </div>

                <!-- Key Usage -->
                <div v-if="keyInfo.subscription" class="ml-10">
                  <div class="flex items-center gap-2">
                    <div class="flex-1 h-1 bg-gray-300 dark:bg-gray-600 rounded-full overflow-hidden">
                      <div
                        class="h-full transition-all duration-300"
                        :class="getKeyUsagePercent(keyInfo) > 90 ? 'bg-red-500' : getKeyUsagePercent(keyInfo) > 70 ? 'bg-yellow-500' : 'bg-green-500'"
                        :style="{ width: getKeyUsagePercent(keyInfo) + '%' }"
                      ></div>
                    </div>
                    <span class="text-xs text-[var(--theme-text-secondary)] w-8">{{ getKeyUsagePercent(keyInfo) }}%</span>
                  </div>
                  <p class="text-xs text-[var(--theme-text-tertiary)] mt-0.5">
                    {{ formatNumber(keyInfo.subscription.characterCount) }} / {{ formatNumber(keyInfo.subscription.characterLimit) }}
                    <span class="ml-2">{{ keyInfo.subscription.tier }}</span>
                  </p>
                </div>
                <div v-else class="ml-10 text-xs text-[var(--theme-text-tertiary)]">
                  Loading subscription info...
                </div>
              </div>
            </div>
          </div>

          <!-- Add Key Modal -->
          <div v-if="showAddKeyModal" class="fixed inset-0 flex items-center justify-center z-60">
            <div class="absolute inset-0 bg-black/50" @click="showAddKeyModal = false"></div>
            <div class="relative bg-[var(--theme-bg-primary)] rounded-lg p-6 w-96 shadow-xl border border-[var(--theme-border)]">
              <h3 class="text-lg font-bold text-[var(--theme-text-primary)] mb-4">Add API Key</h3>

              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-1">API Key</label>
                  <input
                    v-model="newKeyInput"
                    type="password"
                    placeholder="sk_..."
                    class="w-full p-2 rounded-lg bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)] border border-[var(--theme-border)] focus:outline-none focus:border-[var(--theme-primary)]"
                  />
                </div>

                <div>
                  <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-1">Label (optional)</label>
                  <input
                    v-model="newKeyLabel"
                    type="text"
                    placeholder="Personal, Work, etc."
                    class="w-full p-2 rounded-lg bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)] border border-[var(--theme-border)] focus:outline-none focus:border-[var(--theme-primary)]"
                  />
                </div>
              </div>

              <div class="flex gap-2 mt-6">
                <button
                  @click="showAddKeyModal = false"
                  class="flex-1 py-2 rounded-lg bg-gray-500/20 text-[var(--theme-text-secondary)] hover:bg-gray-500/30 transition-colors"
                >
                  Cancel
                </button>
                <button
                  @click="handleAddKey"
                  :disabled="!newKeyInput.trim() || isAddingKey"
                  class="flex-1 py-2 rounded-lg bg-[var(--theme-primary)] text-white hover:bg-[var(--theme-primary-dark)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {{ isAddingKey ? 'Adding...' : 'Add Key' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Cache Info -->
          <div class="bg-[var(--theme-bg-secondary)] rounded-lg p-4 border border-[var(--theme-border)]">
            <h3 class="font-semibold text-[var(--theme-text-primary)] mb-2">💾 Audio Cache</h3>
            <p class="text-sm text-[var(--theme-text-secondary)]">
              {{ cacheStats.itemCount }} project(s) cached
            </p>
            <p class="text-xs text-[var(--theme-text-tertiary)] mt-1">
              Cached audio plays instantly without API calls
            </p>
          </div>
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
import { ref, computed } from 'vue';
import type { VoiceSettings, NotificationRecord } from '../composables/useVoiceNotifications';
import type { ApiKeyInfo, ElevenLabsSubscription } from '../composables/useAudioCache';

const props = defineProps<{
  isOpen: boolean;
  settings: VoiceSettings;
  isSpeaking: boolean;
  notificationHistory: NotificationRecord[];
  cacheStats: { itemCount: number; keys: string[] };
  subscription: ElevenLabsSubscription | null;
  apiKeys: ApiKeyInfo[];
  isRefreshingKeys: boolean;
}>();

// Local state for add key modal
const showAddKeyModal = ref(false);
const newKeyInput = ref('');
const newKeyLabel = ref('');
const isAddingKey = ref(false);

const formatNumber = (n: number): string => {
  return n.toLocaleString();
};

const emit = defineEmits<{
  close: [];
  'update:settings': [settings: Partial<VoiceSettings>];
  toggleEnabled: [];
  testVoice: [];
  replay: [record: NotificationRecord];
  'clear-history': [];
  'clear-cache': [];
  'add-api-key': [key: string, label: string];
  'remove-api-key': [key: string];
  'toggle-api-key': [key: string];
  'refresh-api-keys': [];
}>();

// Mask API key for display (show only last 8 chars)
const maskKey = (key: string): string => {
  if (key.length <= 8) return key;
  return '•'.repeat(key.length - 8) + key.slice(-8);
};

// Get usage percent for a single key
const getKeyUsagePercent = (keyInfo: ApiKeyInfo): number => {
  if (!keyInfo.subscription) return 0;
  return Math.round((keyInfo.subscription.characterCount / keyInfo.subscription.characterLimit) * 100);
};

// Get total usage across all keys
const totalUsage = computed(() => {
  const activeKeys = props.apiKeys.filter(k => k.isActive && k.subscription);
  if (activeKeys.length === 0) return { used: 0, limit: 0, percent: 0 };

  const used = activeKeys.reduce((sum, k) => sum + (k.subscription?.characterCount || 0), 0);
  const limit = activeKeys.reduce((sum, k) => sum + (k.subscription?.characterLimit || 0), 0);
  return { used, limit, percent: limit > 0 ? Math.round((used / limit) * 100) : 0 };
});

// Handle add key form
const handleAddKey = async () => {
  if (!newKeyInput.value.trim()) return;
  isAddingKey.value = true;
  emit('add-api-key', newKeyInput.value.trim(), newKeyLabel.value.trim() || `Key ${props.apiKeys.length + 1}`);
  // Reset form
  newKeyInput.value = '';
  newKeyLabel.value = '';
  showAddKeyModal.value = false;
  isAddingKey.value = false;
};

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

const getTypeIcon = (type: string): string => {
  const icons: Record<string, string> = {
    stop: '✅',
    error: '❌',
    hitl: '🙋',
    notification: '🔔',
    summary: '📢',
    commit: '📝'
  };
  return icons[type] || '❓';
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString();
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
