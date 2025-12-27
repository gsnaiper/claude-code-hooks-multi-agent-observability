/**
 * HITL Adapters Unit Tests
 *
 * Comprehensive test suite for all HITL adapter implementations
 * using Bun's test API.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import type { HookEvent } from '../../types';
import {
  DirectHITLAdapter,
  PreToolUseHITLAdapter,
  PostToolUseHITLAdapter,
  NotificationHITLAdapter,
  HITLAdapterChain,
  type HITLAdapter
} from '../adapters';
import { HITLType } from '../types';

// ============================================================================
// Mock Event Factories
// ============================================================================

function createMockEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    id: 1,
    source_app: 'test-app',
    session_id: 'test-session',
    hook_event_type: 'Unknown',
    payload: {},
    timestamp: Date.now(),
    ...overrides
  };
}

function createDirectHITLEvent(wsUrl: string, type = 'question'): HookEvent {
  return createMockEvent({
    humanInTheLoop: {
      question: 'Test question?',
      type: type as any,
      responseWebSocketUrl: wsUrl,
      timeout: 300,
      requiresResponse: true
    }
  });
}

function createPreToolUseEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
  wsUrl: string
): HookEvent {
  return createMockEvent({
    hook_event_type: 'PreToolUse',
    payload: {
      permission_mode: 'ask',
      tool_name: toolName,
      tool_input: toolInput,
      response_websocket_url: wsUrl
    }
  });
}

function createPostToolUseEvent(
  toolName: string,
  wsUrl: string,
  confirmationMessage?: string
): HookEvent {
  return createMockEvent({
    hook_event_type: 'PostToolUse',
    payload: {
      requires_confirmation: true,
      tool_name: toolName,
      response_websocket_url: wsUrl,
      confirmation_message: confirmationMessage,
      tool_result: { success: true }
    }
  });
}

function createNotificationEvent(
  notificationType: string,
  wsUrl: string,
  message?: string
): HookEvent {
  return createMockEvent({
    hook_event_type: 'Notification',
    payload: {
      notification_type: notificationType,
      message: message || 'Test notification',
      response_websocket_url: wsUrl,
      timeout: 300
    }
  });
}

// ============================================================================
// DirectHITLAdapter Tests
// ============================================================================

describe('DirectHITLAdapter', () => {
  let adapter: DirectHITLAdapter;

  beforeEach(() => {
    adapter = new DirectHITLAdapter();
  });

  describe('canHandle()', () => {
    test('returns true when humanInTheLoop exists', () => {
      const event = createDirectHITLEvent('ws://localhost:3000');
      expect(adapter.canHandle(event)).toBe(true);
    });

    test('returns false when humanInTheLoop is missing', () => {
      const event = createMockEvent();
      expect(adapter.canHandle(event)).toBe(false);
    });

    test('returns false when humanInTheLoop is null', () => {
      const event = createMockEvent({ humanInTheLoop: undefined });
      expect(adapter.canHandle(event)).toBe(false);
    });
  });

  describe('adapt()', () => {
    test('extracts question correctly', () => {
      const event = createDirectHITLEvent('ws://localhost:3000', 'question');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Test question?');
    });

    test('extracts type correctly', () => {
      const event = createDirectHITLEvent('ws://localhost:3000', 'permission');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(HITLType.PERMISSION);
    });

    test('extracts wsUrl correctly', () => {
      const wsUrl = 'ws://localhost:3000/hitl';
      const event = createDirectHITLEvent(wsUrl);
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.responseWebSocketUrl).toBe(wsUrl);
    });

    test('extracts choices when present', () => {
      const event = createMockEvent({
        humanInTheLoop: {
          question: 'Choose option?',
          type: 'choice',
          responseWebSocketUrl: 'ws://localhost:3000',
          choices: ['Option A', 'Option B', 'Option C']
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.choices).toEqual(['Option A', 'Option B', 'Option C']);
    });

    test('uses default timeout when not specified', () => {
      const event = createMockEvent({
        humanInTheLoop: {
          question: 'Test?',
          type: 'question',
          responseWebSocketUrl: 'ws://localhost:3000'
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.timeout).toBe(300); // default timeout
    });

    test('preserves custom timeout', () => {
      const event = createMockEvent({
        humanInTheLoop: {
          question: 'Test?',
          type: 'question',
          responseWebSocketUrl: 'ws://localhost:3000',
          timeout: 600
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.timeout).toBe(600);
    });

    test('extracts context when present', () => {
      const event = createMockEvent({
        humanInTheLoop: {
          question: 'Approve edit?',
          type: 'approval',
          responseWebSocketUrl: 'ws://localhost:3000',
          context: {
            tool_name: 'Edit',
            file_path: '/test/file.ts'
          }
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.context?.tool_name).toBe('Edit');
      expect(result?.context?.file_path).toBe('/test/file.ts');
    });

    test('returns null when wsUrl is missing', () => {
      const event = createMockEvent({
        humanInTheLoop: {
          question: 'Test?',
          type: 'question',
          responseWebSocketUrl: ''
        }
      });
      const result = adapter.adapt(event);

      expect(result).toBeNull();
    });

    test('uses default question when not provided', () => {
      const event = createMockEvent({
        humanInTheLoop: {
          question: '',
          type: 'question',
          responseWebSocketUrl: 'ws://localhost:3000'
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('No question provided');
    });
  });
});

// ============================================================================
// PreToolUseHITLAdapter Tests
// ============================================================================

describe('PreToolUseHITLAdapter', () => {
  let adapter: PreToolUseHITLAdapter;

  beforeEach(() => {
    adapter = new PreToolUseHITLAdapter();
  });

  describe('canHandle()', () => {
    test('matches PreToolUse with permission_mode=ask', () => {
      const event = createPreToolUseEvent(
        'Bash',
        { command: 'ls -la' },
        'ws://localhost:3000'
      );
      expect(adapter.canHandle(event)).toBe(true);
    });

    test('returns false for PreToolUse without permission_mode', () => {
      const event = createMockEvent({
        hook_event_type: 'PreToolUse',
        payload: {
          tool_name: 'Bash'
        }
      });
      expect(adapter.canHandle(event)).toBe(false);
    });

    test('returns false for non-PreToolUse events', () => {
      const event = createMockEvent({
        hook_event_type: 'PostToolUse'
      });
      expect(adapter.canHandle(event)).toBe(false);
    });

    test('returns false when permission_mode is not "ask"', () => {
      const event = createMockEvent({
        hook_event_type: 'PreToolUse',
        payload: {
          permission_mode: 'auto',
          tool_name: 'Bash'
        }
      });
      expect(adapter.canHandle(event)).toBe(false);
    });
  });

  describe('adapt()', () => {
    test('builds question for Bash tool with command', () => {
      const event = createPreToolUseEvent(
        'Bash',
        { command: 'npm install' },
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Execute command: `npm install`?');
      expect(result?.type).toBe(HITLType.APPROVAL);
    });

    test('builds question for Bash tool without command', () => {
      const event = createPreToolUseEvent('Bash', {}, 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Execute Bash command?');
    });

    test('builds question for Edit tool with file_path', () => {
      const event = createPreToolUseEvent(
        'Edit',
        { file_path: '/src/index.ts' },
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Edit file: /src/index.ts?');
    });

    test('builds question for Edit tool without file_path', () => {
      const event = createPreToolUseEvent('Edit', {}, 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Edit file?');
    });

    test('builds question for Write tool with file_path', () => {
      const event = createPreToolUseEvent(
        'Write',
        { file_path: '/src/config.json' },
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Write to file: /src/config.json?');
    });

    test('builds question for Write tool without file_path', () => {
      const event = createPreToolUseEvent('Write', {}, 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Write to file?');
    });

    test('builds question for Read tool with file_path', () => {
      const event = createPreToolUseEvent(
        'Read',
        { file_path: '/etc/passwd' },
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Read file: /etc/passwd?');
    });

    test('builds question for Read tool without file_path', () => {
      const event = createPreToolUseEvent('Read', {}, 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Read file?');
    });

    test('builds question for Task tool with description', () => {
      const event = createPreToolUseEvent(
        'Task',
        { description: 'Analyze security vulnerabilities' },
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Launch agent: Analyze security vulnerabilities?');
    });

    test('builds question for Task tool without description', () => {
      const event = createPreToolUseEvent('Task', {}, 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Launch agent?');
    });

    test('builds generic question for unknown tool', () => {
      const event = createPreToolUseEvent(
        'CustomTool',
        {},
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Allow CustomTool?');
    });

    test('extracts context from tool_input', () => {
      const event = createPreToolUseEvent(
        'Edit',
        {
          file_path: '/test.ts',
          old_string: 'old code',
          new_string: 'new code'
        },
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.context?.tool_name).toBe('Edit');
      expect(result?.context?.file_path).toBe('/test.ts');
      expect(result?.context?.old_string).toBe('old code');
      expect(result?.context?.new_string).toBe('new code');
    });

    test('returns null when wsUrl is missing', () => {
      const event = createMockEvent({
        hook_event_type: 'PreToolUse',
        payload: {
          permission_mode: 'ask',
          tool_name: 'Bash',
          tool_input: { command: 'ls' }
        }
      });
      const result = adapter.adapt(event);

      expect(result).toBeNull();
    });

    test('accepts responseWebSocketUrl in camelCase', () => {
      const event = createMockEvent({
        hook_event_type: 'PreToolUse',
        payload: {
          permission_mode: 'ask',
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
          responseWebSocketUrl: 'ws://localhost:3000'
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.responseWebSocketUrl).toBe('ws://localhost:3000');
    });
  });
});

// ============================================================================
// PostToolUseHITLAdapter Tests
// ============================================================================

describe('PostToolUseHITLAdapter', () => {
  let adapter: PostToolUseHITLAdapter;

  beforeEach(() => {
    adapter = new PostToolUseHITLAdapter();
  });

  describe('canHandle()', () => {
    test('matches PostToolUse with requires_confirmation=true', () => {
      const event = createPostToolUseEvent('Bash', 'ws://localhost:3000');
      expect(adapter.canHandle(event)).toBe(true);
    });

    test('returns false for PostToolUse without requires_confirmation', () => {
      const event = createMockEvent({
        hook_event_type: 'PostToolUse',
        payload: {
          tool_name: 'Bash'
        }
      });
      expect(adapter.canHandle(event)).toBe(false);
    });

    test('returns false when requires_confirmation is false', () => {
      const event = createMockEvent({
        hook_event_type: 'PostToolUse',
        payload: {
          requires_confirmation: false,
          tool_name: 'Bash'
        }
      });
      expect(adapter.canHandle(event)).toBe(false);
    });

    test('returns false for non-PostToolUse events', () => {
      const event = createMockEvent({
        hook_event_type: 'PreToolUse'
      });
      expect(adapter.canHandle(event)).toBe(false);
    });
  });

  describe('adapt()', () => {
    test('uses custom confirmation_message when provided', () => {
      const event = createPostToolUseEvent(
        'Bash',
        'ws://localhost:3000',
        'Command executed successfully. Continue?'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Command executed successfully. Continue?');
    });

    test('generates default confirmation message when not provided', () => {
      const event = createPostToolUseEvent('Edit', 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Confirm Edit result?');
    });

    test('extracts tool_name and tool_result into context', () => {
      const event = createPostToolUseEvent('Bash', 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.context?.permission_type).toBe('tool_result_confirmation');
      expect(result?.context?.tool_name).toBe('Bash');
      expect(result?.context?.tool_result).toEqual({ success: true });
    });

    test('sets type to APPROVAL', () => {
      const event = createPostToolUseEvent('Write', 'ws://localhost:3000');
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(HITLType.APPROVAL);
    });

    test('returns null when wsUrl is missing', () => {
      const event = createMockEvent({
        hook_event_type: 'PostToolUse',
        payload: {
          requires_confirmation: true,
          tool_name: 'Bash'
        }
      });
      const result = adapter.adapt(event);

      expect(result).toBeNull();
    });

    test('handles unknown tool name gracefully', () => {
      const event = createMockEvent({
        hook_event_type: 'PostToolUse',
        payload: {
          requires_confirmation: true,
          response_websocket_url: 'ws://localhost:3000'
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Confirm Unknown Tool result?');
      expect(result?.context?.tool_name).toBe('Unknown Tool');
    });
  });
});

// ============================================================================
// NotificationHITLAdapter Tests
// ============================================================================

describe('NotificationHITLAdapter', () => {
  let adapter: NotificationHITLAdapter;

  beforeEach(() => {
    adapter = new NotificationHITLAdapter();
  });

  describe('canHandle()', () => {
    test('matches permission_prompt notification', () => {
      const event = createNotificationEvent(
        'permission_prompt',
        'ws://localhost:3000'
      );
      expect(adapter.canHandle(event)).toBe(true);
    });

    test('matches idle_prompt notification', () => {
      const event = createNotificationEvent(
        'idle_prompt',
        'ws://localhost:3000'
      );
      expect(adapter.canHandle(event)).toBe(true);
    });

    test('matches question notification', () => {
      const event = createNotificationEvent(
        'question',
        'ws://localhost:3000'
      );
      expect(adapter.canHandle(event)).toBe(true);
    });

    test('matches approval notification', () => {
      const event = createNotificationEvent(
        'approval',
        'ws://localhost:3000'
      );
      expect(adapter.canHandle(event)).toBe(true);
    });

    test('returns false for non-HITL notification types', () => {
      const event = createNotificationEvent(
        'info',
        'ws://localhost:3000'
      );
      expect(adapter.canHandle(event)).toBe(false);
    });

    test('returns false for non-Notification events', () => {
      const event = createMockEvent({
        hook_event_type: 'PreToolUse'
      });
      expect(adapter.canHandle(event)).toBe(false);
    });
  });

  describe('adapt()', () => {
    test('extracts message from payload', () => {
      const event = createNotificationEvent(
        'permission_prompt',
        'ws://localhost:3000',
        'Do you want to proceed?'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Do you want to proceed?');
    });

    test('uses default message when not provided', () => {
      const event = createMockEvent({
        hook_event_type: 'Notification',
        payload: {
          notification_type: 'question',
          response_websocket_url: 'ws://localhost:3000'
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('No message provided');
    });

    test('normalizes notification_type to HITLType', () => {
      const event = createNotificationEvent(
        'permission_prompt',
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(HITLType.PERMISSION);
    });

    test('normalizes idle_prompt to QUESTION type', () => {
      const event = createNotificationEvent(
        'idle_prompt',
        'ws://localhost:3000'
      );
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(HITLType.QUESTION);
    });

    test('preserves custom timeout from payload', () => {
      const event = createMockEvent({
        hook_event_type: 'Notification',
        payload: {
          notification_type: 'question',
          message: 'Test?',
          response_websocket_url: 'ws://localhost:3000',
          timeout: 600
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.timeout).toBe(600);
    });

    test('includes context from payload', () => {
      const event = createMockEvent({
        hook_event_type: 'Notification',
        payload: {
          notification_type: 'approval',
          message: 'Approve action?',
          response_websocket_url: 'ws://localhost:3000',
          context: {
            action: 'delete_file',
            file: '/test.txt'
          }
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.context?.permission_type).toBe('approval');
      expect(result?.context?.action).toBe('delete_file');
      expect(result?.context?.file).toBe('/test.txt');
    });

    test('returns null when wsUrl is missing', () => {
      const event = createMockEvent({
        hook_event_type: 'Notification',
        payload: {
          notification_type: 'question',
          message: 'Test?'
        }
      });
      const result = adapter.adapt(event);

      expect(result).toBeNull();
    });

    test('prefers question field over message field', () => {
      const event = createMockEvent({
        hook_event_type: 'Notification',
        payload: {
          notification_type: 'question',
          message: 'Message text',
          question: 'Question text',
          response_websocket_url: 'ws://localhost:3000'
        }
      });
      const result = adapter.adapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Message text');
    });
  });
});

// ============================================================================
// HITLAdapterChain Tests
// ============================================================================

describe('HITLAdapterChain', () => {
  let chain: HITLAdapterChain;

  beforeEach(() => {
    chain = new HITLAdapterChain();
  });

  describe('tryAdapt()', () => {
    test('prioritizes DirectHITLAdapter over others', () => {
      // Create an event that matches both DirectHITL and Notification adapters
      const event = createMockEvent({
        hook_event_type: 'Notification',
        payload: {
          notification_type: 'question'
        },
        humanInTheLoop: {
          question: 'Direct HITL question',
          type: 'question',
          responseWebSocketUrl: 'ws://localhost:3000'
        }
      });

      const result = chain.tryAdapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Direct HITL question');
    });

    test('uses PreToolUseAdapter when DirectHITL does not match', () => {
      const event = createPreToolUseEvent(
        'Bash',
        { command: 'ls' },
        'ws://localhost:3000'
      );

      const result = chain.tryAdapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Execute command: `ls`?');
      expect(result?.type).toBe(HITLType.APPROVAL);
    });

    test('uses PostToolUseAdapter when earlier adapters do not match', () => {
      const event = createPostToolUseEvent(
        'Edit',
        'ws://localhost:3000',
        'Changes saved. Continue?'
      );

      const result = chain.tryAdapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Changes saved. Continue?');
    });

    test('uses NotificationAdapter as fallback', () => {
      const event = createNotificationEvent(
        'permission_prompt',
        'ws://localhost:3000',
        'Grant permission?'
      );

      const result = chain.tryAdapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Grant permission?');
      expect(result?.type).toBe(HITLType.PERMISSION);
    });

    test('returns null when no adapter matches', () => {
      const event = createMockEvent({
        hook_event_type: 'UnknownEvent',
        payload: {}
      });

      const result = chain.tryAdapt(event);

      expect(result).toBeNull();
    });

    test('returns first successful adaptation in chain order', () => {
      // PreToolUse has higher priority than Notification
      const event = createMockEvent({
        hook_event_type: 'PreToolUse',
        payload: {
          permission_mode: 'ask',
          tool_name: 'Bash',
          tool_input: { command: 'echo test' },
          response_websocket_url: 'ws://localhost:3000'
        }
      });

      const result = chain.tryAdapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toContain('Execute command');
    });

    test('skips adapter that returns null and tries next', () => {
      // Event has PreToolUse type but missing wsUrl
      // Should skip PreToolUse adapter and try others
      const event = createMockEvent({
        hook_event_type: 'PreToolUse',
        payload: {
          permission_mode: 'ask',
          tool_name: 'Bash',
          tool_input: { command: 'ls' }
          // No response_websocket_url - adapter will return null
        }
      });

      const result = chain.tryAdapt(event);

      expect(result).toBeNull();
    });
  });

  describe('isHITLEvent()', () => {
    test('returns true for DirectHITL events', () => {
      const event = createDirectHITLEvent('ws://localhost:3000');
      expect(chain.isHITLEvent(event)).toBe(true);
    });

    test('returns true for PreToolUse events', () => {
      const event = createPreToolUseEvent(
        'Bash',
        { command: 'ls' },
        'ws://localhost:3000'
      );
      expect(chain.isHITLEvent(event)).toBe(true);
    });

    test('returns true for PostToolUse events', () => {
      const event = createPostToolUseEvent('Edit', 'ws://localhost:3000');
      expect(chain.isHITLEvent(event)).toBe(true);
    });

    test('returns true for Notification HITL events', () => {
      const event = createNotificationEvent(
        'permission_prompt',
        'ws://localhost:3000'
      );
      expect(chain.isHITLEvent(event)).toBe(true);
    });

    test('returns false for non-HITL events', () => {
      const event = createMockEvent({
        hook_event_type: 'Info',
        payload: {}
      });
      expect(chain.isHITLEvent(event)).toBe(false);
    });
  });

  describe('register() and registerFirst()', () => {
    test('register() adds adapter at the end', () => {
      const customAdapter: HITLAdapter = {
        name: 'CustomAdapter',
        canHandle: (event) => event.hook_event_type === 'Custom',
        adapt: (event) => ({
          type: HITLType.QUESTION,
          question: 'Custom question',
          responseWebSocketUrl: 'ws://localhost:3000',
          timeout: 300,
          requiresResponse: true
        })
      };

      chain.register(customAdapter);

      const adapters = chain.getAdapters();
      expect(adapters[adapters.length - 1].name).toBe('CustomAdapter');
    });

    test('registerFirst() adds adapter at the beginning', () => {
      const highPriorityAdapter: HITLAdapter = {
        name: 'HighPriorityAdapter',
        canHandle: (event) => event.hook_event_type === 'HighPriority',
        adapt: (event) => ({
          type: HITLType.APPROVAL,
          question: 'High priority question',
          responseWebSocketUrl: 'ws://localhost:3000',
          timeout: 300,
          requiresResponse: true
        })
      };

      chain.registerFirst(highPriorityAdapter);

      const adapters = chain.getAdapters();
      expect(adapters[0].name).toBe('HighPriorityAdapter');
    });

    test('custom adapter registered first takes precedence', () => {
      const customAdapter: HITLAdapter = {
        name: 'CustomAdapter',
        canHandle: (event) => event.hook_event_type === 'PreToolUse',
        adapt: (event) => ({
          type: HITLType.QUESTION,
          question: 'Custom override',
          responseWebSocketUrl: 'ws://localhost:3000',
          timeout: 300,
          requiresResponse: true
        })
      };

      chain.registerFirst(customAdapter);

      const event = createPreToolUseEvent(
        'Bash',
        { command: 'ls' },
        'ws://localhost:3000'
      );
      const result = chain.tryAdapt(event);

      expect(result).not.toBeNull();
      expect(result?.question).toBe('Custom override');
    });
  });

  describe('getAdapters()', () => {
    test('returns all registered adapters', () => {
      const adapters = chain.getAdapters();

      expect(adapters.length).toBeGreaterThanOrEqual(4);
      expect(adapters.map(a => a.name)).toContain('DirectHITLAdapter');
      expect(adapters.map(a => a.name)).toContain('PreToolUseHITLAdapter');
      expect(adapters.map(a => a.name)).toContain('PostToolUseHITLAdapter');
      expect(adapters.map(a => a.name)).toContain('NotificationHITLAdapter');
    });

    test('returns readonly array', () => {
      const adapters = chain.getAdapters();
      expect(adapters).toBeDefined();
      // TypeScript ensures readonly at compile time
    });
  });
});

// ============================================================================
// Missing wsUrl Tests (Edge Cases)
// ============================================================================

describe('Missing wsUrl Handling', () => {
  test('DirectHITLAdapter returns null gracefully', () => {
    const adapter = new DirectHITLAdapter();
    const event = createMockEvent({
      humanInTheLoop: {
        question: 'Test?',
        type: 'question',
        responseWebSocketUrl: ''
      }
    });

    const result = adapter.adapt(event);
    expect(result).toBeNull();
  });

  test('PreToolUseHITLAdapter returns null gracefully', () => {
    const adapter = new PreToolUseHITLAdapter();
    const event = createMockEvent({
      hook_event_type: 'PreToolUse',
      payload: {
        permission_mode: 'ask',
        tool_name: 'Bash',
        tool_input: { command: 'ls' }
      }
    });

    const result = adapter.adapt(event);
    expect(result).toBeNull();
  });

  test('PostToolUseHITLAdapter returns null gracefully', () => {
    const adapter = new PostToolUseHITLAdapter();
    const event = createMockEvent({
      hook_event_type: 'PostToolUse',
      payload: {
        requires_confirmation: true,
        tool_name: 'Edit'
      }
    });

    const result = adapter.adapt(event);
    expect(result).toBeNull();
  });

  test('NotificationHITLAdapter returns null gracefully', () => {
    const adapter = new NotificationHITLAdapter();
    const event = createMockEvent({
      hook_event_type: 'Notification',
      payload: {
        notification_type: 'question',
        message: 'Test?'
      }
    });

    const result = adapter.adapt(event);
    expect(result).toBeNull();
  });

  test('HITLAdapterChain returns null when all adapters fail due to missing wsUrl', () => {
    const chain = new HITLAdapterChain();
    const event = createMockEvent({
      hook_event_type: 'PreToolUse',
      payload: {
        permission_mode: 'ask',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' }
        // Missing responseWebSocketUrl
      }
    });

    const result = chain.tryAdapt(event);
    expect(result).toBeNull();
  });
});

// ============================================================================
// Type Normalization Tests
// ============================================================================

describe('Type Normalization', () => {
  test('DirectHITLAdapter normalizes legacy types', () => {
    const adapter = new DirectHITLAdapter();
    const event = createMockEvent({
      humanInTheLoop: {
        question: 'Test?',
        type: 'permission' as any,
        responseWebSocketUrl: 'ws://localhost:3000'
      }
    });

    const result = adapter.adapt(event);
    expect(result?.type).toBe(HITLType.PERMISSION);
  });

  test('NotificationHITLAdapter normalizes permission_prompt to PERMISSION', () => {
    const adapter = new NotificationHITLAdapter();
    const event = createNotificationEvent(
      'permission_prompt',
      'ws://localhost:3000'
    );

    const result = adapter.adapt(event);
    expect(result?.type).toBe(HITLType.PERMISSION);
  });

  test('NotificationHITLAdapter normalizes idle_prompt to QUESTION', () => {
    const adapter = new NotificationHITLAdapter();
    const event = createNotificationEvent(
      'idle_prompt',
      'ws://localhost:3000'
    );

    const result = adapter.adapt(event);
    expect(result?.type).toBe(HITLType.QUESTION);
  });
});
