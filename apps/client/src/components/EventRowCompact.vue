<template>
  <div v-if="event" class="relative">
    <!-- HITL Event (Compact) -->
    <div
      v-if="event.humanInTheLoop && (event.humanInTheLoopStatus?.status === 'pending' || hasSubmittedResponse)"
      class="rounded border-l-4 p-2 text-xs"
      :class="hasSubmittedResponse || event.humanInTheLoopStatus?.status === 'responded'
        ? 'border-green-500 bg-green-900/20'
        : 'border-yellow-500 bg-yellow-900/20 animate-pulse-slow'"
      @click.stop
    >
      <!-- HITL Header (compact) -->
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-base shrink-0">{{ hitlTypeEmoji }}</span>
          <span class="font-bold truncate" :class="hasSubmittedResponse ? 'text-green-300' : 'text-yellow-300'">
            {{ hitlTypeLabelShort }}
          </span>
          <span v-if="permissionType" class="px-1 py-0.5 bg-blue-900/30 border border-blue-500 text-blue-300 rounded font-mono">
            {{ permissionType }}
          </span>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="text-blue-400">{{ event.source_app }}</span>
          <span class="text-gray-500">{{ sessionIdShort }}</span>
          <span class="text-gray-500">{{ formatTime(event.timestamp) }}</span>
          <button
            v-if="hasAudio && voiceNotifications.settings.value.enabled"
            @click.stop="replayEventAudio"
            :disabled="isPlayingAudio"
            class="p-0.5 rounded"
            :class="isPlayingAudio ? 'animate-pulse text-blue-400' : 'text-gray-500 hover:text-gray-300'"
          >
            <span class="text-sm">{{ isPlayingAudio ? '🔊' : '🔈' }}</span>
          </button>
        </div>
      </div>

      <!-- Question (collapsible) -->
      <div
        class="bg-gray-800 rounded p-1.5 mb-1.5 cursor-pointer"
        @click.stop="hitlExpanded = !hitlExpanded"
      >
        <div class="flex items-start gap-1">
          <span class="text-gray-500 shrink-0">{{ hitlExpanded ? '▼' : '▶' }}</span>
          <p class="text-gray-200" :class="hitlExpanded ? '' : 'line-clamp-2'">
            {{ event.humanInTheLoop.question }}
          </p>
        </div>
      </div>

      <!-- Response Display (Optimistic) -->
      <div v-if="localResponse || (event.humanInTheLoopStatus?.status === 'responded' && event.humanInTheLoopStatus.response)"
           class="bg-green-900/30 rounded p-1.5 mb-1.5 flex items-center gap-2">
        <span class="text-green-400">✅</span>
        <span class="text-green-300 truncate">
          {{ localResponse?.response || localResponse?.choice ||
             (localResponse?.permission !== undefined ? (localResponse.permission ? 'Approved' : 'Denied') : '') ||
             event.humanInTheLoopStatus?.response?.response || 'Responded' }}
        </span>
      </div>

      <!-- Compact HITL Response UIs -->
      <div v-if="!hasSubmittedResponse && event.humanInTheLoopStatus?.status !== 'responded'">
        <!-- Question type: inline input -->
        <div v-if="event.humanInTheLoop.type === 'question'" class="flex gap-1">
          <input
            v-model="responseText"
            type="text"
            class="flex-1 px-2 py-1 bg-gray-800 border border-yellow-500/50 rounded text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400"
            :class="isRecording ? 'border-red-500' : ''"
            :placeholder="isRecording ? 'Listening...' : 'Your response...'"
            @keyup.enter="submitResponse"
            @click.stop
          />
          <button
            v-if="voiceSupported"
            @click.stop="toggleRecording('ru-RU')"
            class="px-2 rounded"
            :class="isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
          >🎤</button>
          <button
            @click.stop="submitResponse"
            :disabled="!responseText.trim() || isSubmitting"
            class="px-3 py-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded font-bold"
          >{{ isSubmitting ? '...' : '✓' }}</button>
        </div>

        <!-- Permission type: compact buttons -->
        <div v-else-if="event.humanInTheLoop.type === 'permission'" class="flex justify-end gap-1">
          <button
            @click.stop="submitPermission(false)"
            :disabled="isSubmitting"
            class="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded font-bold"
          >{{ isSubmitting ? '...' : '❌ Deny' }}</button>
          <button
            @click.stop="submitPermission(true)"
            :disabled="isSubmitting"
            class="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded font-bold"
          >{{ isSubmitting ? '...' : '✅ Allow' }}</button>
        </div>

        <!-- Choice type: inline choices -->
        <div v-else-if="event.humanInTheLoop.type === 'choice'" class="flex flex-wrap gap-1 justify-end">
          <button
            v-for="choice in event.humanInTheLoop.choices"
            :key="choice"
            @click.stop="submitChoice(choice)"
            :disabled="isSubmitting"
            class="px-2 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded text-xs"
          >{{ choice }}</button>
        </div>

        <!-- Approval type: diff preview + buttons -->
        <div v-else-if="event.humanInTheLoop.type === 'approval'" class="space-y-1">
          <!-- Compact diff preview -->
          <div v-if="event.humanInTheLoop.context?.old_string || event.humanInTheLoop.context?.new_string"
               class="bg-gray-900 rounded p-1 font-mono text-[10px] max-h-16 overflow-hidden">
            <div v-if="event.humanInTheLoop.context?.old_string" class="text-red-400 truncate">- {{ event.humanInTheLoop.context.old_string }}</div>
            <div v-if="event.humanInTheLoop.context?.new_string" class="text-green-400 truncate">+ {{ event.humanInTheLoop.context.new_string }}</div>
          </div>
          <!-- Comment + buttons -->
          <div class="flex gap-1">
            <input
              v-model="approvalComment"
              type="text"
              class="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none"
              placeholder="Comment (optional)..."
              @click.stop
            />
            <button
              @click.stop="submitApproval(false)"
              :disabled="isSubmitting"
              class="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded"
            >❌</button>
            <button
              @click.stop="submitApproval(true)"
              :disabled="isSubmitting"
              class="px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded"
            >✅</button>
          </div>
        </div>

        <!-- Question Input type: options + input -->
        <div v-else-if="event.humanInTheLoop.type === 'question_input'" class="space-y-1">
          <!-- Options as compact pills -->
          <div v-if="questionOptions.length > 0" class="flex flex-wrap gap-1">
            <button
              v-for="option in questionOptions"
              :key="option.label"
              @click.stop="selectOption(option.label)"
              class="px-2 py-0.5 rounded text-xs transition-colors"
              :class="selectedOption === option.label
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
            >{{ option.label }}</button>
            <button
              @click.stop="showOtherInput = !showOtherInput; selectedOption = ''"
              class="px-2 py-0.5 rounded text-xs"
              :class="showOtherInput ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
            >✏️ Other</button>
          </div>
          <!-- Input for custom answer -->
          <div v-if="questionOptions.length === 0 || showOtherInput" class="flex gap-1">
            <input
              v-model="responseText"
              type="text"
              class="flex-1 px-2 py-1 bg-gray-800 border border-blue-500/50 rounded text-white placeholder-gray-500 focus:outline-none"
              placeholder="Your answer..."
              @keyup.enter="submitResponse"
              @click.stop
            />
            <button
              v-if="voiceSupported"
              @click.stop="toggleRecording('ru-RU')"
              class="px-2 rounded"
              :class="isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-300'"
            >🎤</button>
          </div>
          <!-- Action buttons -->
          <div class="flex justify-end gap-1">
            <button
              @click.stop="submitQuestionCancel"
              :disabled="isSubmitting"
              class="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs"
            >Cancel</button>
            <button
              @click.stop="submitResponse"
              :disabled="!responseText.trim() || isSubmitting"
              class="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white rounded font-bold"
            >{{ isSubmitting ? '...' : 'Reply' }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Regular Event (Compact) -->
    <div
      v-else
      class="group flex items-stretch gap-0 bg-gray-800/50 hover:bg-gray-800 rounded cursor-pointer transition-colors text-xs border-l-4"
      :style="{ borderLeftColor: appHexColor }"
      @click="toggleExpanded"
    >
      <!-- Session color indicator (thin stripe) -->
      <div class="w-1 shrink-0" :class="gradientClass"></div>

      <!-- Content -->
      <div class="flex-1 min-w-0 p-1.5">
        <!-- Main row -->
        <div class="flex items-center gap-1.5">
          <!-- Tags (inline) -->
          <ClickableTag
            field="source_app"
            :value="event.source_app"
            custom-class="px-1 py-0.5 text-xs font-medium rounded"
            :custom-style="{ backgroundColor: appHexColor + '40', color: appHexColor }"
            @filter="handleTagFilter"
          >{{ event.source_app }}</ClickableTag>

          <ClickableTag
            v-if="event.project_id"
            field="project_id"
            :value="event.project_id"
            custom-class="px-1 py-0.5 text-xs text-blue-400 hover:text-blue-200 max-w-[120px] mobile:max-w-[80px] shrink-0"
            @filter="handleTagFilter"
          >{{ event.project_id }}</ClickableTag>

          <ClickableTag
            v-if="!collapseTags"
            field="session_id"
            :value="event.session_id"
            custom-class="px-1 py-0.5 text-xs text-gray-400 hover:text-gray-200"
            @filter="handleTagFilter"
          >{{ sessionIdShort }}</ClickableTag>

          <ClickableTag
            v-if="event.model_name && !collapseTags"
            field="model_name"
            :value="event.model_name"
            custom-class="px-1 py-0.5 text-xs text-purple-400"
            @filter="handleTagFilter"
          >{{ formatModelName(event.model_name) }}</ClickableTag>

          <ClickableTag
            v-if="!collapseTags"
            field="hook_event_type"
            :value="event.hook_event_type"
            custom-class="px-1 py-0.5 text-xs font-bold text-white bg-blue-600 rounded"
            @filter="handleTagFilter"
          >{{ hookEmoji }} {{ event.hook_event_type.slice(0, 4) }}</ClickableTag>

          <!-- Tool info -->
          <div v-if="toolInfo" class="flex items-center gap-1 min-w-0 flex-1">
            <ClickableTag
              v-if="event.tool_name"
              field="tool_name"
              :value="event.tool_name"
              custom-class="px-1 py-0.5 text-xs font-medium text-blue-300 bg-blue-900/50 rounded shrink-0"
              @filter="handleTagFilter"
            >{{ toolInfo.tool }}</ClickableTag>
            <span v-if="toolInfo.detail" class="text-gray-400 font-mono truncate">{{ toolInfo.detail }}</span>
          </div>

          <!-- Summary badge -->
          <span v-if="event.summary" class="px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded truncate max-w-[30%] shrink-0">
            📝 {{ event.summary }}
          </span>

          <!-- Right side: time + audio -->
          <div class="flex items-center gap-1 ml-auto shrink-0">
            <span class="text-gray-500">{{ formatTime(event.timestamp) }}</span>
            <button
              v-if="hasAudio && voiceNotifications.settings.value.enabled"
              @click.stop="replayEventAudio"
              :disabled="isPlayingAudio"
              class="p-0.5"
              :class="isPlayingAudio ? 'animate-pulse text-blue-400' : 'text-gray-500 hover:text-gray-300'"
            >
              <span class="text-sm">{{ isPlayingAudio ? '🔊' : '🔈' }}</span>
            </button>
            <span class="text-gray-600">{{ isExpanded ? '▲' : '▼' }}</span>
          </div>
        </div>

        <!-- Compact Bash response preview -->
        <div v-if="compactToolResponse && !isExpanded" class="mt-1 flex items-center gap-2 text-[10px] font-mono">
          <span :class="compactToolResponse.exitCode === 0 ? 'text-green-500' : 'text-red-500'">
            {{ compactToolResponse.exitCode === 0 ? '✓' : '✗' }}
          </span>
          <span class="text-gray-500">stdout:{{ compactToolResponse.stdoutLines }}</span>
          <span v-if="compactToolResponse.stderrLines > 0" class="text-red-400">stderr:{{ compactToolResponse.stderrLines }}</span>
          <span v-if="compactToolResponse.stdoutPreview" class="text-gray-500 truncate">{{ compactToolResponse.stdoutPreview }}</span>
        </div>

        <!-- Expanded content -->
        <div v-if="isExpanded" class="mt-2 pt-2 border-t border-gray-700 space-y-2">
          <!-- Payload -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <span class="text-gray-400 font-bold">📦 Payload</span>
              <button
                @click.stop="copyPayload"
                class="px-2 py-0.5 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
              >{{ copyButtonText }}</button>
            </div>
            <div v-if="isLoadingPayload" class="text-gray-500 text-center py-2">
              <span class="animate-spin inline-block">⏳</span> Loading...
            </div>
            <div v-else-if="detailLoadError" class="text-red-400 py-1">{{ detailLoadError }}</div>
            <pre v-else class="bg-gray-900 p-2 rounded text-[10px] font-mono overflow-x-auto max-h-40 overflow-y-auto text-gray-300">{{ formattedPayload }}</pre>
          </div>

          <!-- Chat transcript button -->
          <button
            v-if="fullEvent?.chat && fullEvent.chat.length > 0 && !isMobile"
            @click.stop="showChatModal = true"
            class="w-full px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center justify-center gap-1"
          >
            <span>💬</span>
            <span>Chat ({{ fullEvent.chat.length }})</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Chat Modal -->
    <ChatTranscriptModal
      v-if="fullEvent?.chat && fullEvent.chat.length > 0"
      :is-open="showChatModal"
      :chat="fullEvent.chat"
      @close="showChatModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { EventSummary, HookEvent, HumanInTheLoopResponse } from '../types';
import { useMediaQuery } from '../composables/useMediaQuery';
import { useVoiceInput } from '../composables/useVoiceInput';
import { useVoiceNotifications } from '../composables/useVoiceNotifications';
import { useEventDetail } from '../composables/useEventDetail';
import ChatTranscriptModal from './ChatTranscriptModal.vue';
import ClickableTag from './ClickableTag.vue';
import { API_BASE_URL } from '../config';

const props = defineProps<{
  event: EventSummary;
  gradientClass: string;
  colorClass: string;
  appGradientClass: string;
  appColorClass: string;
  appHexColor: string;
  collapseTags?: boolean;
}>();

const emit = defineEmits<{
  (e: 'response-submitted', response: HumanInTheLoopResponse): void;
  (e: 'filter', payload: { field: string; value: string }): void;
}>();

// Event detail loading
const { fetchEventDetail, isLoading: isLoadingDetail } = useEventDetail();
const fullEvent = ref<HookEvent | null>(null);
const detailLoadError = ref<string | null>(null);

// UI State
const isExpanded = ref(false);
const hitlExpanded = ref(false);
const showChatModal = ref(false);
const copyButtonText = ref('📋 Copy');

// HITL State
const responseText = ref('');
const approvalComment = ref('');
const isSubmitting = ref(false);
const hasSubmittedResponse = ref(false);
const localResponse = ref<HumanInTheLoopResponse | null>(null);
const selectedOption = ref<string>('');
const selectedOptions = ref<string[]>([]);
const showOtherInput = ref(false);

// Composables
const { isMobile } = useMediaQuery();
const { isRecording, isTranscribing, transcript, isSupported: voiceSupported, toggleRecording, clearTranscript } = useVoiceInput();
const voiceNotifications = useVoiceNotifications();
const isPlayingAudio = ref(false);
const lastReplayCost = ref<number | null>(null);

// Watch transcript for voice input
watch(transcript, (newTranscript) => {
  if (newTranscript) {
    responseText.value = newTranscript;
  }
});

// Computed
const sessionIdShort = computed(() => props.event?.session_id?.slice(0, 8) || '');

const hookEmoji = computed(() => {
  const emojiMap: Record<string, string> = {
    'PreToolUse': '🔧', 'PostToolUse': '✅', 'Notification': '🔔',
    'Stop': '🛑', 'SubagentStop': '👥', 'PreCompact': '📦',
    'UserPromptSubmit': '💬', 'SessionStart': '🚀', 'SessionEnd': '🏁'
  };
  return emojiMap[props.event?.hook_event_type || ''] || '❓';
});

const hitlTypeEmoji = computed(() => {
  const emojiMap: Record<string, string> = {
    question: '❓', permission: '🔐', choice: '🎯', approval: '✅', question_input: '💬'
  };
  return emojiMap[props.event.humanInTheLoop?.type || ''] || '❓';
});

const hitlTypeLabelShort = computed(() => {
  const map: Record<string, string> = {
    question: 'Question', permission: 'Permission', choice: 'Choice',
    approval: 'Approval', question_input: 'Input'
  };
  return map[props.event.humanInTheLoop?.type || ''] || 'Question';
});

const permissionType = computed(() => {
  return props.event.humanInTheLoop?.context?.permission_type || null;
});

const questionOptions = computed(() => {
  return props.event.humanInTheLoop?.context?.questions?.[0]?.options || [];
});

const toolInfo = computed(() => {
  if (!props.event) return null;
  const { tool_name, tool_command, tool_file_path, hook_event_type } = props.event;

  if (hook_event_type === 'UserPromptSubmit') return { tool: 'Prompt', detail: '(user)' };
  if (hook_event_type === 'PreCompact') return { tool: 'Compact', detail: '' };
  if (hook_event_type === 'SessionStart') return { tool: 'Session', detail: 'started' };

  if (tool_name) {
    return {
      tool: tool_name,
      detail: tool_command || tool_file_path?.split('/').pop() || ''
    };
  }
  return null;
});

const compactToolResponse = computed(() => {
  if (props.event?.hook_event_type !== 'PostToolUse' || props.event?.tool_name !== 'Bash') return null;
  const response = (props.event as any).tool_response;
  if (!response) return null;

  const stdout = response.stdout || '';
  const stderr = response.stderr || '';
  return {
    exitCode: response.exitCode ?? (stderr ? 1 : 0),
    stdoutLines: stdout ? stdout.split('\n').filter((l: string) => l.trim()).length : 0,
    stderrLines: stderr ? stderr.split('\n').filter((l: string) => l.trim()).length : 0,
    stdoutPreview: stdout.split('\n')[0]?.substring(0, 50) || null
  };
});

const formattedPayload = computed(() => {
  return fullEvent.value ? JSON.stringify(fullEvent.value.payload, null, 2) : '{ "loading": true }';
});

const isLoadingPayload = computed(() => {
  return isExpanded.value && !fullEvent.value && isLoadingDetail(props.event?.id);
});

const hasAudio = computed(() => {
  if (!voiceNotifications.isConfigured.value) return false;
  if (props.event.humanInTheLoop?.question) return true;
  if (props.event.summary) return true;
  if (props.event.hook_event_type === 'PostToolUse' && props.event.tool_name === 'Bash') {
    return (props.event.tool_command || '').includes('git commit');
  }
  return false;
});

// Methods
const handleTagFilter = (payload: { field: string; value: string }) => emit('filter', payload);

const formatTime = (ts?: number) => ts ? new Date(ts).toLocaleTimeString() : '';

const formatModelName = (name: string | null | undefined): string => {
  if (!name) return '';
  const parts = name.split('-');
  return parts.length >= 4 ? `${parts[1]}-${parts[2]}` : name;
};

const toggleExpanded = async () => {
  isExpanded.value = !isExpanded.value;
  if (isExpanded.value && !fullEvent.value && props.event.id) {
    detailLoadError.value = null;
    const detail = await fetchEventDetail(props.event.id);
    if (detail) fullEvent.value = detail;
    else detailLoadError.value = 'Failed to load';
  }
};

const copyPayload = async () => {
  try {
    await navigator.clipboard.writeText(formattedPayload.value);
    copyButtonText.value = '✅';
    setTimeout(() => copyButtonText.value = '📋 Copy', 2000);
  } catch { copyButtonText.value = '❌'; setTimeout(() => copyButtonText.value = '📋 Copy', 2000); }
};

const selectOption = (label: string) => {
  selectedOption.value = label;
  responseText.value = label;
  showOtherInput.value = false;
};

// HITL Submit methods
const submitResponse = async () => {
  if (!responseText.value.trim() || !props.event.id) return;
  const response: HumanInTheLoopResponse = { response: responseText.value.trim(), hookEvent: props.event, respondedAt: Date.now() };
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  const saved = responseText.value;
  responseText.value = '';
  clearTranscript();
  isSubmitting.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response)
    });
    if (!res.ok) throw new Error();
    emit('response-submitted', response);
  } catch {
    localResponse.value = null; hasSubmittedResponse.value = false; responseText.value = saved;
    alert('Failed to submit');
  } finally { isSubmitting.value = false; }
};

const submitPermission = async (approved: boolean) => {
  if (!props.event.id) return;
  const response: HumanInTheLoopResponse = { permission: approved, hookEvent: props.event, respondedAt: Date.now() };
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  isSubmitting.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response)
    });
    if (!res.ok) throw new Error();
    emit('response-submitted', response);
  } catch {
    localResponse.value = null; hasSubmittedResponse.value = false;
    alert('Failed to submit');
  } finally { isSubmitting.value = false; }
};

const submitChoice = async (choice: string) => {
  if (!props.event.id) return;
  const response: HumanInTheLoopResponse = { choice, hookEvent: props.event, respondedAt: Date.now() };
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  isSubmitting.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response)
    });
    if (!res.ok) throw new Error();
    emit('response-submitted', response);
  } catch {
    localResponse.value = null; hasSubmittedResponse.value = false;
    alert('Failed to submit');
  } finally { isSubmitting.value = false; }
};

const submitApproval = async (approved: boolean) => {
  if (!props.event.id) return;
  const response: HumanInTheLoopResponse = { approved, comment: approvalComment.value.trim() || undefined, hookEvent: props.event, respondedAt: Date.now() };
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  approvalComment.value = '';
  clearTranscript();
  isSubmitting.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response)
    });
    if (!res.ok) throw new Error();
    emit('response-submitted', response);
  } catch {
    localResponse.value = null; hasSubmittedResponse.value = false;
    alert('Failed to submit');
  } finally { isSubmitting.value = false; }
};

const submitQuestionCancel = async () => {
  if (!props.event.id) return;
  const response: HumanInTheLoopResponse = { cancelled: true, hookEvent: props.event, respondedAt: Date.now() };
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  isSubmitting.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response)
    });
    if (!res.ok) throw new Error();
    emit('response-submitted', response);
  } catch {
    localResponse.value = null; hasSubmittedResponse.value = false;
    alert('Failed to cancel');
  } finally { isSubmitting.value = false; }
};

// Audio replay
const getEventAudioText = (): string | null => {
  if (props.event.humanInTheLoop) {
    let text = props.event.humanInTheLoop.question || '';
    if (props.event.humanInTheLoop.type === 'choice' && props.event.humanInTheLoop.choices?.length) {
      text += `. Options: ${props.event.humanInTheLoop.choices.join(', ')}`;
    }
    return text || null;
  }
  if (props.event.summary) return props.event.summary;
  if (props.event.hook_event_type === 'PostToolUse' && props.event.tool_name === 'Bash') {
    const cmd = props.event.tool_command || '';
    if (cmd.includes('git commit')) {
      const match = cmd.match(/git commit[^$]*-m\s*["']([^"'$]+)["']/);
      if (match) return `Commit: ${match[1]}`;
    }
  }
  return null;
};

const replayEventAudio = async () => {
  if (isPlayingAudio.value || !voiceNotifications.settings.value.enabled) return;
  const text = getEventAudioText();
  if (!text) return;
  isPlayingAudio.value = true;
  try {
    const result = await voiceNotifications.audioCache.generateWithoutCache(
      text, voiceNotifications.settings.value.voiceId, props.event.source_app
    );
    lastReplayCost.value = result.characterCost;
    await voiceNotifications.playBlob(result.blob);
  } catch (e) { console.error('Audio replay error:', e); }
  finally { isPlayingAudio.value = false; }
};
</script>

<style scoped>
@keyframes pulse-slow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.9; }
}
.animate-pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
