<template>
  <div v-if="event">
    <!-- HITL Question Section (NEW) -->
    <div
      v-if="event.humanInTheLoop && (event.humanInTheLoopStatus?.status === 'pending' || hasSubmittedResponse)"
      class="mb-4 p-4 rounded-lg border-2 shadow-lg"
      :class="hasSubmittedResponse || event.humanInTheLoopStatus?.status === 'responded' ? 'border-green-500 bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20' : 'border-yellow-500 bg-gradient-to-r from-yellow-50 to-yellow-100 dark:from-yellow-900/20 dark:to-yellow-800/20 animate-pulse-slow'"
      @click.stop
    >
      <!-- Question Header -->
      <div class="mb-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center space-x-2">
            <span class="text-2xl">{{ hitlTypeEmoji }}</span>
            <h3 class="text-lg font-bold" :class="hasSubmittedResponse || event.humanInTheLoopStatus?.status === 'responded' ? 'text-green-900 dark:text-green-100' : 'text-yellow-900 dark:text-yellow-100'">
              {{ hitlTypeLabel }}
            </h3>
            <span v-if="permissionType" class="text-xs font-mono font-semibold px-2 py-1 rounded border-2 bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-900 dark:text-blue-100">
              {{ permissionType }}
            </span>
          </div>
          <span v-if="!hasSubmittedResponse && event.humanInTheLoopStatus?.status !== 'responded'" class="text-xs font-semibold text-yellow-700 dark:text-yellow-300">
            ⏱️ Waiting for response...
          </span>
        </div>
        <div class="flex items-center space-x-2 ml-9">
          <span
            class="text-xs font-semibold text-[var(--theme-text-primary)] px-1.5 py-0.5 rounded-full border-2 bg-[var(--theme-bg-tertiary)] shadow-sm"
            :style="{ ...appBgStyle, ...appBorderStyle }"
          >
            {{ event.source_app }}
          </span>
          <span class="text-xs text-[var(--theme-text-secondary)] px-1.5 py-0.5 rounded-full border bg-[var(--theme-bg-tertiary)]/50 shadow-sm" :class="borderColorClass">
            {{ sessionIdShort }}
          </span>
          <span class="text-xs text-[var(--theme-text-tertiary)] font-medium">
            {{ formatTime(event.timestamp) }}
          </span>
          <!-- Audio replay button for HITL -->
          <button
            v-if="hasAudio && voiceNotifications.settings.value.enabled"
            @click.stop="replayEventAudio"
            :disabled="isPlayingAudio"
            class="ml-2 p-1 rounded-full transition-all duration-200 hover:bg-[var(--theme-bg-tertiary)] flex items-center gap-1"
            :class="isPlayingAudio ? 'animate-pulse text-[var(--theme-primary)]' : 'text-[var(--theme-text-tertiary)] hover:text-[var(--theme-primary)]'"
            :title="isPlayingAudio ? 'Playing...' : 'Replay audio'"
          >
            <span class="text-sm">{{ isPlayingAudio ? '🔊' : '🔈' }}</span>
            <span v-if="lastReplayCost !== null" class="text-xs opacity-70">{{ lastReplayCost }}</span>
          </button>
        </div>
      </div>

      <!-- Question Text -->
      <div class="mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg border" :class="hasSubmittedResponse || event.humanInTheLoopStatus?.status === 'responded' ? 'border-green-300' : 'border-yellow-300'">
        <p class="text-base font-medium text-gray-900 dark:text-gray-100">
          {{ event.humanInTheLoop.question }}
        </p>
      </div>

      <!-- Inline Response Display (Optimistic UI) -->
      <div v-if="localResponse || (event.humanInTheLoopStatus?.status === 'responded' && event.humanInTheLoopStatus.response)" class="mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg border border-green-400">
        <div class="flex items-center mb-2">
          <span class="text-xl mr-2">✅</span>
          <strong class="text-green-900 dark:text-green-100">Your Response:</strong>
        </div>
        <div v-if="(localResponse?.response || event.humanInTheLoopStatus?.response?.response)" class="text-gray-900 dark:text-gray-100 ml-7">
          {{ localResponse?.response || event.humanInTheLoopStatus?.response?.response }}
        </div>
        <div v-if="(localResponse?.permission !== undefined || event.humanInTheLoopStatus?.response?.permission !== undefined)" class="text-gray-900 dark:text-gray-100 ml-7">
          {{ (localResponse?.permission ?? event.humanInTheLoopStatus?.response?.permission) ? 'Approved ✅' : 'Denied ❌' }}
        </div>
        <div v-if="(localResponse?.choice || event.humanInTheLoopStatus?.response?.choice)" class="text-gray-900 dark:text-gray-100 ml-7">
          {{ localResponse?.choice || event.humanInTheLoopStatus?.response?.choice }}
        </div>
      </div>

      <!-- Response UI -->
      <div v-if="event.humanInTheLoop.type === 'question'">
        <!-- Text Input for Questions with Voice Input -->
        <div class="relative">
          <textarea
            v-model="responseText"
            class="w-full p-3 pr-14 border-2 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent resize-none transition-colors"
            :class="isRecording ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : (isTranscribing ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-yellow-500')"
            rows="3"
            :placeholder="isRecording ? 'Listening...' : (isTranscribing ? 'Transcribing...' : 'Type your response here...')"
            @click.stop
          ></textarea>
          <!-- Microphone Button (inside textarea) -->
          <button
            v-if="voiceSupported"
            @click.stop="toggleRecording('ru-RU')"
            :disabled="isTranscribing"
            class="absolute right-3 top-3 p-2 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
            :class="isRecording
              ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
              : (isTranscribing
                ? 'bg-blue-500 text-white animate-pulse cursor-wait'
                : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200')"
            :title="isRecording ? 'Stop recording' : (isTranscribing ? 'Transcribing...' : 'Start voice input')"
          >
            <span class="text-xl">{{ isRecording ? '🔴' : (isTranscribing ? '⏳' : '🎤') }}</span>
          </button>
        </div>
        <div class="flex justify-end space-x-2 mt-2">
          <button
            @click.stop="submitResponse"
            :disabled="!responseText.trim() || isSubmitting || hasSubmittedResponse"
            class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none disabled:cursor-not-allowed"
          >
            {{ isSubmitting ? '⏳ Sending...' : '✅ Submit Response' }}
          </button>
        </div>
      </div>

      <div v-else-if="event.humanInTheLoop.type === 'permission'">
        <!-- Yes/No Buttons for Permissions -->
        <div class="flex justify-end items-center space-x-3">
          <div v-if="hasSubmittedResponse || event.humanInTheLoopStatus?.status === 'responded'" class="flex items-center px-3 py-2 bg-green-100 dark:bg-green-900/30 rounded-lg border border-green-500">
            <span class="text-sm font-bold text-green-900 dark:text-green-100">Responded</span>
          </div>
          <button
            @click.stop="submitPermission(false)"
            :disabled="isSubmitting || hasSubmittedResponse"
            class="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105"
            :class="hasSubmittedResponse ? 'opacity-40 cursor-not-allowed' : ''"
          >
            {{ isSubmitting ? '⏳' : '❌ Deny' }}
          </button>
          <button
            @click.stop="submitPermission(true)"
            :disabled="isSubmitting || hasSubmittedResponse"
            class="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105"
            :class="hasSubmittedResponse ? 'opacity-40 cursor-not-allowed' : ''"
          >
            {{ isSubmitting ? '⏳' : '✅ Approve' }}
          </button>
        </div>
      </div>

      <div v-else-if="event.humanInTheLoop.type === 'choice'">
        <!-- Multiple Choice Buttons -->
        <div class="flex flex-wrap gap-2 justify-end">
          <button
            v-for="choice in event.humanInTheLoop.choices"
            :key="choice"
            @click.stop="submitChoice(choice)"
            :disabled="isSubmitting || hasSubmittedResponse"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none"
          >
            {{ isSubmitting ? '⏳' : choice }}
          </button>
        </div>
      </div>

      <div v-else-if="event.humanInTheLoop.type === 'approval'">
        <!-- Approval with optional comment (text/voice input) -->
        <div class="space-y-3">
          <!-- Diff Display for Edit operations -->
          <div v-if="event.humanInTheLoop.context?.old_string || event.humanInTheLoop.context?.new_string" class="font-mono text-sm bg-gray-900 rounded-lg overflow-hidden">
            <div class="px-3 py-2 bg-gray-800 text-gray-300 border-b border-gray-700 flex items-center gap-2">
              <span>📝</span>
              <span class="text-xs">{{ event.humanInTheLoop.context?.file_path || 'File Edit' }}</span>
            </div>
            <div class="p-3 space-y-1">
              <div v-if="event.humanInTheLoop.context?.old_string" class="text-red-400 whitespace-pre-wrap break-all">
                <span class="select-none">- </span>{{ event.humanInTheLoop.context.old_string }}
              </div>
              <div v-if="event.humanInTheLoop.context?.new_string" class="text-green-400 whitespace-pre-wrap break-all">
                <span class="select-none">+ </span>{{ event.humanInTheLoop.context.new_string }}
              </div>
            </div>
          </div>

          <!-- Content Preview for Write operations -->
          <div v-else-if="event.humanInTheLoop.context?.content" class="font-mono text-sm bg-gray-900 rounded-lg overflow-hidden">
            <div class="px-3 py-2 bg-gray-800 text-gray-300 border-b border-gray-700 flex items-center gap-2">
              <span>📄</span>
              <span class="text-xs">{{ event.humanInTheLoop.context?.file_path || 'New File' }}</span>
            </div>
            <div class="p-3 text-green-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {{ event.humanInTheLoop.context.content }}
            </div>
          </div>

          <!-- Optional comment input -->
          <div class="relative">
            <textarea
              v-model="approvalComment"
              class="w-full p-3 pr-14 border-2 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent resize-none transition-colors"
              :class="isRecording ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : (isTranscribing ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600')"
              rows="2"
              :placeholder="isRecording ? 'Listening...' : (isTranscribing ? 'Transcribing...' : 'Optional comment (voice or text)...')"
              @click.stop
            ></textarea>
            <!-- Microphone Button -->
            <button
              v-if="voiceSupported"
              @click.stop="toggleApprovalVoiceInput"
              :disabled="isTranscribing"
              class="absolute right-3 top-3 p-2 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              :class="isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                : (isTranscribing
                  ? 'bg-blue-500 text-white animate-pulse cursor-wait'
                  : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200')"
              :title="isRecording ? 'Stop recording' : (isTranscribing ? 'Transcribing...' : 'Voice input')"
            >
              <span class="text-xl">{{ isRecording ? '🔴' : (isTranscribing ? '⏳' : '🎤') }}</span>
            </button>
          </div>

          <!-- Approve/Deny buttons -->
          <div class="flex justify-end items-center space-x-3">
            <div v-if="hasSubmittedResponse || event.humanInTheLoopStatus?.status === 'responded'" class="flex items-center px-3 py-2 bg-green-100 dark:bg-green-900/30 rounded-lg border border-green-500">
              <span class="text-sm font-bold text-green-900 dark:text-green-100">Responded</span>
            </div>
            <button
              @click.stop="submitApproval(false)"
              :disabled="isSubmitting || hasSubmittedResponse"
              class="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105"
              :class="hasSubmittedResponse ? 'opacity-40 cursor-not-allowed' : ''"
            >
              {{ isSubmitting ? '⏳' : '❌ Deny' }}
            </button>
            <button
              @click.stop="submitApproval(true)"
              :disabled="isSubmitting || hasSubmittedResponse"
              class="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105"
              :class="hasSubmittedResponse ? 'opacity-40 cursor-not-allowed' : ''"
            >
              {{ isSubmitting ? '⏳' : '✅ Approve' }}
            </button>
          </div>
        </div>
      </div>

      <div v-else-if="event.humanInTheLoop.type === 'question_input'">
        <!-- Question Input - Claude's question redirected to UI -->
        <div class="space-y-3">
          <!-- Claude's Question Display -->
          <div class="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
            <div class="flex items-start gap-2">
              <span class="text-2xl">🤖</span>
              <div>
                <span class="font-bold text-blue-800 dark:text-blue-200">Claude asks:</span>
                <p class="mt-1 text-blue-900 dark:text-blue-100 whitespace-pre-wrap">{{ event.humanInTheLoop.question }}</p>
              </div>
            </div>
          </div>

          <!-- Options Selection (if available) -->
          <div v-if="questionOptions.length > 0" class="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
            <p class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {{ isMultiSelect ? 'Select one or more options:' : 'Choose an option:' }}
            </p>

            <!-- Single Select (Radio Buttons) -->
            <div v-if="!isMultiSelect" class="space-y-2">
              <label
                v-for="option in questionOptions"
                :key="option.label"
                class="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                :class="selectedOption === option.label ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-600' : ''"
              >
                <input
                  type="radio"
                  :value="option.label"
                  v-model="selectedOption"
                  @change="showOtherInput = false; responseText = option.label"
                  class="mt-1 w-4 h-4 text-blue-600"
                />
                <div>
                  <span class="font-medium text-gray-900 dark:text-gray-100">{{ option.label }}</span>
                  <p v-if="option.description" class="text-sm text-gray-500 dark:text-gray-400">{{ option.description }}</p>
                </div>
              </label>
              <!-- Other option -->
              <label
                class="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                :class="showOtherInput ? 'bg-purple-50 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600' : ''"
              >
                <input
                  type="radio"
                  value="__other__"
                  v-model="selectedOption"
                  @change="showOtherInput = true; responseText = ''"
                  class="mt-1 w-4 h-4 text-purple-600"
                />
                <div>
                  <span class="font-medium text-gray-900 dark:text-gray-100">✏️ Other (custom answer)</span>
                  <p class="text-sm text-gray-500 dark:text-gray-400">Type your own response below</p>
                </div>
              </label>
            </div>

            <!-- Multi Select (Checkboxes) -->
            <div v-else class="space-y-2">
              <label
                v-for="option in questionOptions"
                :key="option.label"
                class="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                :class="selectedOptions.includes(option.label) ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-600' : ''"
              >
                <input
                  type="checkbox"
                  :value="option.label"
                  v-model="selectedOptions"
                  @change="responseText = selectedOptions.join(', ')"
                  class="mt-1 w-4 h-4 text-blue-600 rounded"
                />
                <div>
                  <span class="font-medium text-gray-900 dark:text-gray-100">{{ option.label }}</span>
                  <p v-if="option.description" class="text-sm text-gray-500 dark:text-gray-400">{{ option.description }}</p>
                </div>
              </label>
              <!-- Toggle for custom input -->
              <button
                @click.stop="showOtherInput = !showOtherInput"
                class="flex items-center gap-2 p-2 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded-lg transition-colors"
              >
                <span>✏️</span>
                <span class="font-medium">{{ showOtherInput ? 'Hide custom input' : 'Add custom answer' }}</span>
              </button>
            </div>
          </div>

          <!-- Response Input with Voice (shown always for "Other" or when no options) -->
          <div class="relative" v-if="questionOptions.length === 0 || showOtherInput">
            <textarea
              v-model="responseText"
              class="w-full p-3 pr-14 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none transition-colors"
              :class="isRecording ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : (isTranscribing ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-blue-300 dark:border-blue-600')"
              rows="3"
              :placeholder="isRecording ? 'Listening...' : (isTranscribing ? 'Transcribing...' : 'Type or speak your answer...')"
              @click.stop
            ></textarea>
            <!-- Microphone Button -->
            <button
              v-if="voiceSupported"
              @click.stop="toggleRecording('ru-RU')"
              :disabled="isTranscribing"
              class="absolute right-3 top-3 p-2 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              :class="isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                : (isTranscribing
                  ? 'bg-blue-500 text-white animate-pulse cursor-wait'
                  : 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200')"
              :title="isRecording ? 'Stop recording' : (isTranscribing ? 'Transcribing...' : 'Voice input')"
            >
              <span class="text-xl">{{ isRecording ? '🔴' : (isTranscribing ? '⏳' : '🎤') }}</span>
            </button>
          </div>

          <!-- Action Buttons -->
          <div class="flex justify-end items-center space-x-3">
            <div v-if="hasSubmittedResponse || event.humanInTheLoopStatus?.status === 'responded'" class="flex items-center px-3 py-2 bg-green-100 dark:bg-green-900/30 rounded-lg border border-green-500">
              <span class="text-sm font-bold text-green-900 dark:text-green-100">Answered</span>
            </div>
            <button
              @click.stop="submitQuestionCancel"
              :disabled="isSubmitting || hasSubmittedResponse"
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
              :class="hasSubmittedResponse ? 'opacity-40 cursor-not-allowed' : ''"
            >
              {{ isSubmitting ? '⏳' : '❌ Cancel' }}
            </button>
            <button
              @click.stop="submitResponse"
              :disabled="!responseText.trim() || isSubmitting || hasSubmittedResponse"
              class="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none disabled:cursor-not-allowed"
            >
              {{ isSubmitting ? '⏳ Sending...' : '✅ Reply' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Original Event Row Content (skip if HITL with humanInTheLoop) -->
    <div
      v-if="!event.humanInTheLoop"
      class="group relative p-4 mobile:p-2 rounded-lg shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer border border-[var(--theme-border-primary)] hover:border-[var(--theme-primary)] bg-gradient-to-r from-[var(--theme-bg-primary)] to-[var(--theme-bg-secondary)]"
      :class="{ 'ring-2 ring-[var(--theme-primary)] border-[var(--theme-primary)] shadow-2xl': isExpanded }"
      @click="toggleExpanded"
    >
    <!-- App color indicator -->
    <div 
      class="absolute left-0 top-0 bottom-0 w-3 rounded-l-lg"
      :style="{ backgroundColor: appHexColor }"
    ></div>
    
    <!-- Session color indicator -->
    <div 
      class="absolute left-3 top-0 bottom-0 w-1.5"
      :class="gradientClass"
    ></div>
    
    <div class="ml-4">
      <!-- Desktop Layout: Original horizontal layout -->
      <div class="hidden mobile:block mb-2">
        <!-- Mobile: App + Time on first row -->
        <div class="flex items-center justify-between mb-1">
          <ClickableTag
            field="source_app"
            :value="event.source_app"
            custom-class="text-xs font-semibold text-[var(--theme-text-primary)] px-1.5 py-0.5 border-2 bg-[var(--theme-bg-tertiary)] shadow-md"
            :custom-style="{ ...appBgStyle, ...appBorderStyle }"
            @filter="handleTagFilter"
          >
            {{ event.source_app }}
          </ClickableTag>
          <div class="flex items-center space-x-1">
            <span class="text-xs text-[var(--theme-text-tertiary)] font-medium">
              {{ formatTime(event.timestamp) }}
            </span>
            <!-- Audio replay button (mobile) -->
            <button
              v-if="hasAudio && voiceNotifications.settings.value.enabled"
              @click.stop="replayEventAudio"
              :disabled="isPlayingAudio"
              class="p-1 rounded-full transition-all duration-200 flex items-center gap-0.5"
              :class="isPlayingAudio ? 'animate-pulse text-[var(--theme-primary)]' : 'text-[var(--theme-text-tertiary)]'"
              :title="isPlayingAudio ? 'Playing...' : 'Replay audio'"
            >
              <span class="text-sm">{{ isPlayingAudio ? '🔊' : '🔈' }}</span>
              <span v-if="lastReplayCost !== null" class="text-xs opacity-70">{{ lastReplayCost }}</span>
            </button>
          </div>
        </div>

        <!-- Mobile: Session + Event Type on second row -->
        <div class="flex items-center space-x-2" v-show="!collapseTags">
          <ClickableTag
            field="session_id"
            :value="event.session_id"
            :custom-class="`text-xs text-[var(--theme-text-secondary)] px-1.5 py-0.5 border bg-[var(--theme-bg-tertiary)]/50 ${borderColorClass}`"
            @filter="handleTagFilter"
          >
            {{ sessionIdShort }}
          </ClickableTag>
          <ClickableTag
            v-if="event.model_name"
            field="model_name"
            :value="event.model_name"
            custom-class="text-xs text-[var(--theme-text-secondary)] px-1.5 py-0.5 border bg-[var(--theme-bg-tertiary)]/50 shadow-sm"
            :title="`Model: ${event.model_name}`"
            @filter="handleTagFilter"
          >
            <span class="mr-0.5">🧠</span>{{ formatModelName(event.model_name) }}
          </ClickableTag>
          <ClickableTag
            field="hook_event_type"
            :value="event.hook_event_type"
            custom-class="px-1.5 py-0.5 text-xs font-bold bg-[var(--theme-primary)] text-white shadow-md"
            @filter="handleTagFilter"
          >
            <span class="mr-1 text-sm">{{ hookEmoji }}</span>
            {{ event.hook_event_type }}
          </ClickableTag>
        </div>
      </div>

      <!-- Desktop Layout: Original single row layout -->
      <div class="flex items-center justify-between mb-2 mobile:hidden">
        <div class="flex items-center space-x-4">
          <ClickableTag
            field="source_app"
            :value="event.source_app"
            custom-class="text-base font-bold text-[var(--theme-text-primary)] px-2 py-0.5 border-2 bg-[var(--theme-bg-tertiary)] shadow-lg"
            :custom-style="{ ...appBgStyle, ...appBorderStyle }"
            @filter="handleTagFilter"
          >
            {{ event.source_app }}
          </ClickableTag>
          <ClickableTag
            v-show="!collapseTags"
            field="session_id"
            :value="event.session_id"
            :custom-class="`text-sm text-[var(--theme-text-secondary)] px-2 py-0.5 border bg-[var(--theme-bg-tertiary)]/50 shadow-md ${borderColorClass}`"
            @filter="handleTagFilter"
          >
            {{ sessionIdShort }}
          </ClickableTag>
          <ClickableTag
            v-if="event.model_name"
            v-show="!collapseTags"
            field="model_name"
            :value="event.model_name"
            custom-class="text-sm text-[var(--theme-text-secondary)] px-2 py-0.5 border bg-[var(--theme-bg-tertiary)]/50 shadow-md"
            :title="`Model: ${event.model_name}`"
            @filter="handleTagFilter"
          >
            <span class="mr-1">🧠</span>{{ formatModelName(event.model_name) }}
          </ClickableTag>
          <ClickableTag
            v-show="!collapseTags"
            field="hook_event_type"
            :value="event.hook_event_type"
            custom-class="px-3 py-0.5 text-sm font-bold bg-[var(--theme-primary)] text-white shadow-lg"
            @filter="handleTagFilter"
          >
            <span class="mr-1.5 text-base">{{ hookEmoji }}</span>
            {{ event.hook_event_type }}
          </ClickableTag>
        </div>
        <div class="flex items-center space-x-2">
          <span class="text-sm text-[var(--theme-text-tertiary)] font-semibold">
            {{ formatTime(event.timestamp) }}
          </span>
          <!-- Audio replay button -->
          <button
            v-if="hasAudio && voiceNotifications.settings.value.enabled"
            @click.stop="replayEventAudio"
            :disabled="isPlayingAudio"
            class="p-1.5 rounded-full transition-all duration-200 hover:bg-[var(--theme-bg-tertiary)] shadow-sm flex items-center gap-1"
            :class="isPlayingAudio ? 'animate-pulse text-[var(--theme-primary)] bg-[var(--theme-primary)]/10' : 'text-[var(--theme-text-tertiary)] hover:text-[var(--theme-primary)]'"
            :title="isPlayingAudio ? 'Playing...' : 'Replay audio'"
          >
            <span class="text-base">{{ isPlayingAudio ? '🔊' : '🔈' }}</span>
            <span v-if="lastReplayCost !== null" class="text-xs opacity-70">{{ lastReplayCost }}</span>
          </button>
        </div>
      </div>

      <!-- Tool info and Summary - Desktop Layout -->
      <div class="flex items-center justify-between mb-2 mobile:hidden">
        <div v-if="toolInfo" class="text-base text-[var(--theme-text-secondary)] font-semibold flex flex-wrap items-baseline gap-2">
          <ClickableTag
            v-if="event.tool_name"
            field="tool_name"
            :value="event.tool_name"
            custom-class="font-medium italic px-2 py-0.5 border-2 border-[var(--theme-primary)] bg-[var(--theme-primary-light)] shadow-sm"
            @filter="handleTagFilter"
          >
            {{ toolInfo.tool }}
          </ClickableTag>
          <span v-else class="font-medium italic px-2 py-0.5 rounded border-2 border-[var(--theme-primary)] bg-[var(--theme-primary-light)] shadow-sm">{{ toolInfo.tool }}</span>
          <span v-if="toolInfo.detail" class="text-[var(--theme-text-tertiary)] font-mono text-sm break-all" :class="{ 'italic': event.hook_event_type === 'UserPromptSubmit' }">{{ toolInfo.detail }}</span>
          <span v-if="toolInfo.description" class="text-[var(--theme-text-quaternary)] text-sm italic">— {{ toolInfo.description }}</span>
        </div>

        <!-- Summary aligned to the right -->
        <div v-if="event.summary" class="max-w-[50%] px-3 py-1.5 bg-[var(--theme-primary)]/10 border border-[var(--theme-primary)]/30 rounded-lg shadow-md">
          <span class="text-sm text-[var(--theme-text-primary)] font-semibold">
            <span class="mr-1">📝</span>
            {{ event.summary }}
          </span>
        </div>
      </div>

      <!-- Compact Tool Response - for Bash commands with stdout/stderr -->
      <div v-if="compactToolResponse && !isExpanded" class="mb-2 mobile:hidden">
        <div class="font-mono text-xs bg-gray-900 rounded-lg overflow-hidden border border-gray-700">
          <!-- Compact header with status -->
          <div class="flex items-center justify-between px-2 py-1 bg-gray-800 text-gray-400 border-b border-gray-700">
            <span class="flex items-center gap-1">
              <span>{{ compactToolResponse.exitCode === 0 ? '✅' : '❌' }}</span>
              <span class="text-gray-500">stdout:</span>
              <span class="text-green-400">{{ compactToolResponse.stdoutLines }}L</span>
              <span v-if="compactToolResponse.stderrLines > 0" class="ml-2">
                <span class="text-gray-500">stderr:</span>
                <span class="text-red-400">{{ compactToolResponse.stderrLines }}L</span>
              </span>
            </span>
            <button
              @click.stop="toggleExpanded"
              class="text-gray-500 hover:text-gray-300 text-xs"
            >
              [expand]
            </button>
          </div>
          <!-- Preview of stdout (first 2 lines) -->
          <div v-if="compactToolResponse.stdoutPreview" class="px-2 py-1 text-green-400 whitespace-pre-wrap break-all max-h-12 overflow-hidden">{{ compactToolResponse.stdoutPreview }}</div>
        </div>
      </div>

      <!-- Tool info and Summary - Mobile Layout -->
      <div class="space-y-2 hidden mobile:block mb-2">
        <div v-if="toolInfo" class="text-sm text-[var(--theme-text-secondary)] font-semibold w-full flex flex-wrap items-baseline gap-1.5">
          <ClickableTag
            v-if="event.tool_name"
            field="tool_name"
            :value="event.tool_name"
            custom-class="font-medium italic px-1.5 py-0.5 border-2 border-[var(--theme-primary)] bg-[var(--theme-primary-light)] shadow-sm"
            @filter="handleTagFilter"
          >
            {{ toolInfo.tool }}
          </ClickableTag>
          <span v-else class="font-medium italic px-1.5 py-0.5 rounded border-2 border-[var(--theme-primary)] bg-[var(--theme-primary-light)] shadow-sm">{{ toolInfo.tool }}</span>
          <span v-if="toolInfo.detail" class="text-[var(--theme-text-tertiary)] font-mono text-xs break-all" :class="{ 'italic': event.hook_event_type === 'UserPromptSubmit' }">{{ toolInfo.detail }}</span>
          <span v-if="toolInfo.description" class="text-[var(--theme-text-quaternary)] text-xs italic">— {{ toolInfo.description }}</span>
        </div>
        
        <div v-if="event.summary" class="w-full px-2 py-1 bg-[var(--theme-primary)]/10 border border-[var(--theme-primary)]/30 rounded-lg shadow-md">
          <span class="text-xs text-[var(--theme-text-primary)] font-semibold">
            <span class="mr-1">📝</span>
            {{ event.summary }}
          </span>
        </div>
      </div>
      
      <!-- Expanded content -->
      <div v-if="isExpanded" class="mt-2 pt-2 border-t-2 border-[var(--theme-primary)] bg-gradient-to-r from-[var(--theme-bg-primary)] to-[var(--theme-bg-secondary)] rounded-b-lg p-3 space-y-3">
        <!-- Payload -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-base mobile:text-sm font-bold text-[var(--theme-primary)] drop-shadow-sm flex items-center">
              <span class="mr-1.5 text-xl mobile:text-base">📦</span>
              Payload
            </h4>
            <button
              @click.stop="copyPayload"
              class="px-3 py-1 mobile:px-2 mobile:py-0.5 text-sm mobile:text-xs font-bold rounded-lg bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-dark)] text-white transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 flex items-center space-x-1"
            >
              <span>{{ copyButtonText }}</span>
            </button>
          </div>
          <!-- Loading indicator -->
          <div v-if="isLoadingPayload" class="flex items-center justify-center p-4 text-[var(--theme-text-secondary)]">
            <span class="animate-spin mr-2">⏳</span>
            Loading payload...
          </div>
          <!-- Error message -->
          <div v-else-if="detailLoadError" class="p-3 text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg">
            {{ detailLoadError }}
          </div>
          <!-- Payload content -->
          <pre v-else class="text-sm mobile:text-xs text-[var(--theme-text-primary)] bg-[var(--theme-bg-tertiary)] p-3 mobile:p-2 rounded-lg overflow-x-auto max-h-64 overflow-y-auto font-mono border border-[var(--theme-primary)]/30 shadow-md hover:shadow-lg transition-shadow duration-200">{{ formattedPayload }}</pre>
        </div>

        <!-- Chat transcript button (only visible when full event is loaded) -->
        <div v-if="fullEvent?.chat && fullEvent.chat.length > 0" class="flex justify-end">
          <button
            @click.stop="!isMobile && (showChatModal = true)"
            :class="[
              'px-4 py-2 mobile:px-3 mobile:py-1.5 font-bold rounded-lg transition-all duration-200 flex items-center space-x-1.5 shadow-md hover:shadow-lg',
              isMobile 
                ? 'bg-[var(--theme-bg-quaternary)] cursor-not-allowed opacity-50 text-[var(--theme-text-quaternary)] border border-[var(--theme-border-tertiary)]' 
                : 'bg-gradient-to-r from-[var(--theme-primary)] to-[var(--theme-primary-light)] hover:from-[var(--theme-primary-dark)] hover:to-[var(--theme-primary)] text-white border border-[var(--theme-primary-dark)] transform hover:scale-105'
            ]"
            :disabled="isMobile"
          >
            <span class="text-base mobile:text-sm">💬</span>
            <span class="text-sm mobile:text-xs font-bold drop-shadow-sm">
              {{ isMobile ? 'Not available in mobile' : `View Chat Transcript (${fullEvent?.chat?.length || 0} messages)` }}
            </span>
          </button>
        </div>
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

// Event detail loading
const { fetchEventDetail, isLoading: isLoadingDetail } = useEventDetail();
const fullEvent = ref<HookEvent | null>(null);
const detailLoadError = ref<string | null>(null);

const emit = defineEmits<{
  (e: 'response-submitted', response: HumanInTheLoopResponse): void;
  (e: 'filter', payload: { field: string; value: string }): void;
}>();

// Handler for clickable tag filters
const handleTagFilter = (payload: { field: string; value: string }) => {
  emit('filter', payload);
};

// Existing refs
const isExpanded = ref(false);
const showChatModal = ref(false);
const copyButtonText = ref('📋 Copy');

// New refs for HITL
const responseText = ref('');
const approvalComment = ref(''); // For approval type HITL
const isSubmitting = ref(false);
const hasSubmittedResponse = ref(false);
const localResponse = ref<HumanInTheLoopResponse | null>(null); // Optimistic UI

// Options selection for question_input type
const selectedOption = ref<string>(''); // For single-select (radio)
const selectedOptions = ref<string[]>([]); // For multi-select (checkboxes)
const showOtherInput = ref(false); // Show text input when "Other" is selected

// Computed: Extract question options from HITL context
const questionOptions = computed(() => {
  const ctx = props.event.humanInTheLoop?.context;
  if (!ctx?.questions?.[0]?.options) return [];
  return ctx.questions[0].options;
});

const isMultiSelect = computed(() => {
  const ctx = props.event.humanInTheLoop?.context;
  return ctx?.questions?.[0]?.multiSelect === true;
});

// Media query for responsive design
const { isMobile } = useMediaQuery();

// Voice input for HITL responses
const { isRecording, isTranscribing, transcript, isSupported: voiceSupported, toggleRecording, clearTranscript } = useVoiceInput();

// Voice notifications for audio replay
const voiceNotifications = useVoiceNotifications();
const isPlayingAudio = ref(false);

// Track which field voice input is for (question response vs approval comment)
const voiceInputTarget = ref<'response' | 'approval'>('response');

// Watch transcript changes and update the appropriate text field
watch(transcript, (newTranscript) => {
  if (newTranscript) {
    if (voiceInputTarget.value === 'approval') {
      approvalComment.value = newTranscript;
    } else {
      responseText.value = newTranscript;
    }
  }
});

// Toggle voice input for approval comment
const toggleApprovalVoiceInput = async () => {
  voiceInputTarget.value = 'approval';
  await toggleRecording('ru-RU');
};

const toggleExpanded = async () => {
  isExpanded.value = !isExpanded.value;

  // Fetch full event detail when expanding (if not already loaded)
  if (isExpanded.value && !fullEvent.value && props.event.id) {
    detailLoadError.value = null;
    const detail = await fetchEventDetail(props.event.id);
    if (detail) {
      fullEvent.value = detail;
    } else {
      detailLoadError.value = 'Failed to load event details';
    }
  }
};

const sessionIdShort = computed(() => {
  if (!props.event?.session_id) return '';
  return props.event.session_id.slice(0, 8);
});

const hookEmoji = computed(() => {
  if (!props.event?.hook_event_type) return '❓';
  const emojiMap: Record<string, string> = {
    'PreToolUse': '🔧',
    'PostToolUse': '✅',
    'Notification': '🔔',
    'Stop': '🛑',
    'SubagentStop': '👥',
    'PreCompact': '📦',
    'UserPromptSubmit': '💬',
    'SessionStart': '🚀',
    'SessionEnd': '🏁'
  };
  return emojiMap[props.event.hook_event_type] || '❓';
});

const borderColorClass = computed(() => {
  // Convert bg-color-500 to border-color-500
  return props.colorClass.replace('bg-', 'border-');
});


const appBorderStyle = computed(() => {
  return {
    borderColor: props.appHexColor
  };
});

const appBgStyle = computed(() => {
  // Use the hex color with 20% opacity
  return {
    backgroundColor: props.appHexColor + '33' // Add 33 for 20% opacity in hex
  };
});

const formattedPayload = computed(() => {
  if (fullEvent.value) {
    return JSON.stringify(fullEvent.value.payload, null, 2);
  }
  return '{ "loading": true }';
});

const isLoadingPayload = computed(() => {
  if (!props.event?.id) return false;
  return isExpanded.value && !fullEvent.value && isLoadingDetail(props.event.id);
});

// Compact tool response for PostToolUse events with stdout/stderr
const compactToolResponse = computed(() => {
  if (!props.event) return null;
  if (props.event.hook_event_type !== 'PostToolUse') return null;
  if (props.event.tool_name !== 'Bash') return null;

  // Check if we have tool_response data in the event (from EventSummary)
  const response = (props.event as any).tool_response;
  if (!response) return null;

  const stdout = response.stdout || '';
  const stderr = response.stderr || '';
  const exitCode = response.exitCode ?? (stderr ? 1 : 0);

  const stdoutLines = stdout ? stdout.split('\n').filter((l: string) => l.trim()).length : 0;
  const stderrLines = stderr ? stderr.split('\n').filter((l: string) => l.trim()).length : 0;

  // Preview first 2 lines of stdout
  const lines = stdout.split('\n').slice(0, 2);
  const stdoutPreview = lines.join('\n').substring(0, 150);

  return {
    exitCode,
    stdoutLines,
    stderrLines,
    stdoutPreview: stdoutPreview || null
  };
});

const toolInfo = computed(() => {
  // Guard against undefined event during Vue reactivity updates
  if (!props.event) return null;

  // Use extracted fields from EventSummary for list view
  const { tool_name, tool_command, tool_file_path, hook_event_type } = props.event;

  // Handle special event types (simplified display without full payload)
  if (hook_event_type === 'UserPromptSubmit') {
    return { tool: 'Prompt:', detail: '(user input)' };
  }

  if (hook_event_type === 'PreCompact') {
    return { tool: 'Compaction:', detail: 'context compaction' };
  }

  if (hook_event_type === 'SessionStart') {
    return { tool: 'Session:', detail: 'started' };
  }

  // Handle tool-based events using extracted fields
  if (tool_name) {
    const info: { tool: string; detail?: string; description?: string } = { tool: tool_name };

    if (tool_command) {
      info.detail = tool_command; // Full command without truncation
    } else if (tool_file_path) {
      info.detail = tool_file_path.split('/').pop();
    }

    // Add description from tool_input if available
    if (props.event.tool_description) {
      info.description = props.event.tool_description;
    }

    return info;
  }

  return null;
});

const formatTime = (timestamp?: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
};

// Format model name for display (e.g., "claude-haiku-4-5-20251001" -> "haiku-4-5")
const formatModelName = (name: string | null | undefined): string => {
  if (!name) return '';

  // Extract model family and version
  // "claude-haiku-4-5-20251001" -> "haiku-4-5"
  // "claude-sonnet-4-5-20250929" -> "sonnet-4-5"
  const parts = name.split('-');
  if (parts.length >= 4) {
    return `${parts[1]}-${parts[2]}-${parts[3]}`;
  }
  return name;
};

const copyPayload = async () => {
  try {
    await navigator.clipboard.writeText(formattedPayload.value);
    copyButtonText.value = '✅ Copied!';
    setTimeout(() => {
      copyButtonText.value = '📋 Copy';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
    copyButtonText.value = '❌ Failed';
    setTimeout(() => {
      copyButtonText.value = '📋 Copy';
    }, 2000);
  }
};

// New computed properties for HITL
const hitlTypeEmoji = computed(() => {
  if (!props.event.humanInTheLoop) return '';
  const emojiMap: Record<string, string> = {
    question: '❓',
    permission: '🔐',
    choice: '🎯',
    approval: '✅',
    question_input: '💬'
  };
  return emojiMap[props.event.humanInTheLoop.type] || '❓';
});

const hitlTypeLabel = computed(() => {
  if (!props.event.humanInTheLoop) return '';
  const labelMap: Record<string, string> = {
    question: 'Agent Question',
    permission: 'Permission Request',
    choice: 'Choice Required',
    approval: 'Approval Required',
    question_input: 'Input Required'
  };
  return labelMap[props.event.humanInTheLoop.type] || 'Question';
});

const permissionType = computed(() => {
  // Try to get permission_type from HITL context or full event
  return props.event.humanInTheLoop?.context?.permission_type
    || fullEvent.value?.payload?.permission_type
    || null;
});

// Methods for HITL responses
const submitResponse = async () => {
  if (!responseText.value.trim() || !props.event.id) return;

  const response: HumanInTheLoopResponse = {
    response: responseText.value.trim(),
    hookEvent: props.event,
    respondedAt: Date.now()
  };

  // Optimistic UI: Show response immediately
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  const savedText = responseText.value;
  responseText.value = '';
  clearTranscript(); // Clear voice input state
  isSubmitting.value = true;

  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    });

    if (!res.ok) throw new Error('Failed to submit response');

    emit('response-submitted', response);
  } catch (error) {
    console.error('Error submitting response:', error);
    // Rollback optimistic update
    localResponse.value = null;
    hasSubmittedResponse.value = false;
    responseText.value = savedText;
    alert('Failed to submit response. Please try again.');
  } finally {
    isSubmitting.value = false;
  }
};

const submitPermission = async (approved: boolean) => {
  if (!props.event.id) return;

  const response: HumanInTheLoopResponse = {
    permission: approved,
    hookEvent: props.event,
    respondedAt: Date.now()
  };

  // Optimistic UI: Show response immediately
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  isSubmitting.value = true;

  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    });

    if (!res.ok) throw new Error('Failed to submit permission');

    emit('response-submitted', response);
  } catch (error) {
    console.error('Error submitting permission:', error);
    // Rollback optimistic update
    localResponse.value = null;
    hasSubmittedResponse.value = false;
    alert('Failed to submit permission. Please try again.');
  } finally {
    isSubmitting.value = false;
  }
};

const submitChoice = async (choice: string) => {
  if (!props.event.id) return;

  const response: HumanInTheLoopResponse = {
    choice,
    hookEvent: props.event,
    respondedAt: Date.now()
  };

  // Optimistic UI: Show response immediately
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  isSubmitting.value = true;

  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    });

    if (!res.ok) throw new Error('Failed to submit choice');

    emit('response-submitted', response);
  } catch (error) {
    console.error('Error submitting choice:', error);
    // Rollback optimistic update
    localResponse.value = null;
    hasSubmittedResponse.value = false;
    alert('Failed to submit choice. Please try again.');
  } finally {
    isSubmitting.value = false;
  }
};

const submitApproval = async (approved: boolean) => {
  if (!props.event.id) return;

  const response: HumanInTheLoopResponse = {
    approved,
    comment: approvalComment.value.trim() || undefined,
    hookEvent: props.event,
    respondedAt: Date.now()
  };

  // Optimistic UI: Show response immediately
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  const savedComment = approvalComment.value;
  approvalComment.value = '';
  clearTranscript(); // Clear voice input state
  isSubmitting.value = true;

  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    });

    if (!res.ok) throw new Error('Failed to submit approval');

    emit('response-submitted', response);
  } catch (error) {
    console.error('Error submitting approval:', error);
    // Rollback optimistic update
    localResponse.value = null;
    hasSubmittedResponse.value = false;
    approvalComment.value = savedComment;
    alert('Failed to submit approval. Please try again.');
  } finally {
    isSubmitting.value = false;
  }
};

// Cancel a question_input HITL request
const submitQuestionCancel = async () => {
  if (!props.event.id) return;

  const response: HumanInTheLoopResponse = {
    cancelled: true,
    hookEvent: props.event,
    respondedAt: Date.now()
  };

  // Optimistic UI
  localResponse.value = response;
  hasSubmittedResponse.value = true;
  isSubmitting.value = true;

  try {
    const res = await fetch(`${API_BASE_URL}/events/${props.event.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    });

    if (!res.ok) throw new Error('Failed to cancel question');

    emit('response-submitted', response);
  } catch (error) {
    console.error('Error cancelling question:', error);
    localResponse.value = null;
    hasSubmittedResponse.value = false;
    alert('Failed to cancel. Please try again.');
  } finally {
    isSubmitting.value = false;
  }
};

// Check if event has audio content that can be replayed
const hasAudio = computed(() => {
  if (!voiceNotifications.isConfigured.value) return false;

  // HITL events with question
  if (props.event.humanInTheLoop?.question) return true;

  // Events with summary
  if (props.event.summary) return true;

  // Git commit events (using extracted fields from EventSummary)
  if (props.event.hook_event_type === 'PostToolUse') {
    const command = props.event.tool_command || '';
    if (props.event.tool_name === 'Bash' && command.includes('git commit')) {
      return true;
    }
  }

  return false;
});

// Get text to speak for this event
const getEventAudioText = (): string | null => {
  // HITL question with choices
  if (props.event.humanInTheLoop) {
    const hitl = props.event.humanInTheLoop;
    let text = hitl.question || '';

    if (hitl.type === 'choice' && hitl.choices?.length) {
      const choicesText = hitl.choices.map((c, i) => `${i + 1}: ${c}`).join('. ');
      text += `. Options: ${choicesText}`;
    }
    return text || null;
  }

  // Summary
  if (props.event.summary) {
    return props.event.summary;
  }

  // Git commit (using extracted command from EventSummary)
  if (props.event.hook_event_type === 'PostToolUse') {
    const command = props.event.tool_command || '';
    if (props.event.tool_name === 'Bash' && command.includes('git commit')) {
      // Extract commit message using same logic as useVoiceNotifications
      const heredocMatch = command.match(/git commit.*-m\s*"\$\(cat\s*<<['"]?EOF['"]?\s*\n([\s\S]*?)\n\s*EOF/);
      if (heredocMatch) {
        const lines = heredocMatch[1].split('\n').map((l: string) => l.trim()).filter((l: string) => l);
        if (lines[0]) return `Commit: ${lines[0]}`;
      }

      const simpleMatch = command.match(/git commit[^$]*-m\s*["']([^"'$]+)["']/);
      if (simpleMatch) return `Commit: ${simpleMatch[1]}`;
    }
  }

  return null;
};

// Track character cost for last replay
const lastReplayCost = ref<number | null>(null);

// Replay audio for this event
const replayEventAudio = async () => {
  if (isPlayingAudio.value || !voiceNotifications.settings.value.enabled) return;

  const text = getEventAudioText();
  if (!text) return;

  isPlayingAudio.value = true;
  lastReplayCost.value = null;

  try {
    const result = await voiceNotifications.audioCache.generateWithoutCache(
      text,
      voiceNotifications.settings.value.voiceId,
      props.event.source_app
    );
    lastReplayCost.value = result.characterCost;
    await voiceNotifications.playBlob(result.blob);
  } catch (error) {
    console.error('Audio replay error:', error);
  } finally {
    isPlayingAudio.value = false;
  }
};
</script>

<style scoped>
@keyframes pulse-slow {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.95;
  }
}

.animate-pulse-slow {
  animation: pulse-slow 2s ease-in-out infinite;
}
</style>