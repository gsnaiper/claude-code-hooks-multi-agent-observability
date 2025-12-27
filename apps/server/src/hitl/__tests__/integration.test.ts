/**
 * HITL Integration Tests
 *
 * End-to-end integration tests for the complete HITL (Human-In-The-Loop) flow.
 * Tests full flow from event → adapter → service → response for all HITL types.
 */

import { describe, test, expect, beforeEach, afterEach, mock, jest } from 'bun:test';
import { HITLService } from '../service';
import { HITLAdapterChain } from '../adapters';
import type { HITLRequest, HITLResponse, HITLStatus } from '../types';
import { HITLType } from '../types';
import type { HookEvent } from '../../types';

// Environment setup/teardown helpers
const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset to default config
  delete process.env.HITL_DEBUG;
  delete process.env.HITL_DEFAULT_TIMEOUT;
  delete process.env.HITL_WS_WHITELIST;
  delete process.env.HITL_WS_RETRY_ATTEMPTS;
  delete process.env.HITL_WS_RETRY_DELAY;

  // Use fake timers for timeout testing
  jest.useFakeTimers();
});

afterEach(() => {
  // Restore original env
  process.env = { ...originalEnv };

  // Restore real timers
  jest.useRealTimers();
});

/**
 * Helper: Create mock HookEvent
 */
function createHookEvent(
  id: number,
  type: string,
  payload: Record<string, any> = {}
): HookEvent {
  return {
    id,
    source_app: 'test-app',
    session_id: 'test-session-123',
    hook_event_type: type,
    payload,
    timestamp: Date.now()
  };
}

/**
 * Helper: Create mock HITLResponse
 */
function createHITLResponse(
  eventId: number,
  overrides: Partial<HITLResponse> = {}
): HITLResponse {
  return {
    eventId,
    respondedAt: Date.now(),
    ...overrides
  };
}

describe('HITL Integration Tests', () => {
  let service: HITLService;
  let adapterChain: HITLAdapterChain;
  let statusUpdateCallback: ReturnType<typeof mock>;

  beforeEach(() => {
    // Use real adapter chain for integration tests
    adapterChain = new HITLAdapterChain();
    service = new HITLService(adapterChain);

    // Setup status update callback to track DB updates
    statusUpdateCallback = mock(async (eventId: number, status: HITLStatus) => {
      // Simulate DB write
      return Promise.resolve();
    });
    service.setStatusUpdateCallback(statusUpdateCallback);
  });

  afterEach(() => {
    service.shutdown();
  });

  describe('Full Flow: QUESTION Type', () => {
    test('processes DirectHITL QUESTION event end-to-end', async () => {
      // 1. Create event with direct humanInTheLoop field
      const event = createHookEvent(1, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'What is your favorite color?',
        responseWebSocketUrl: 'ws://localhost:4000/hitl/response',
        timeout: 60,
        requiresResponse: true
      };

      // 2. Process event through adapter → service
      const hitlRequest = await service.processEvent(event);

      // 3. Verify request was created
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.QUESTION);
      expect(hitlRequest!.question).toBe('What is your favorite color?');
      expect(hitlRequest!.responseWebSocketUrl).toBe('ws://localhost:4000/hitl/response');

      // 4. Verify service state
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.pendingRequests).toBe(1);

      // 5. User responds
      const response = createHITLResponse(1, {
        response: 'Blue',
        respondedBy: 'user-123'
      });
      const handleResult = await service.handleResponse(1, response);

      // 6. Verify response handling
      expect(handleResult).toBe(true);

      // 7. Verify status callback was called
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const [eventId, status] = statusUpdateCallback.mock.calls[0];
      expect(eventId).toBe(1);
      expect(status.status).toBe('responded');
      expect(status.response?.response).toBe('Blue');

      // 8. Verify final metrics
      const finalMetrics = service.getMetrics();
      expect(finalMetrics.totalResponses).toBe(1);
      expect(finalMetrics.pendingRequests).toBe(0);
      expect(finalMetrics.totalTimeouts).toBe(0);
    });

    test('handles Notification QUESTION event (idle_prompt)', async () => {
      // 1. Create notification event with idle_prompt type (legacy)
      const event = createHookEvent(2, 'Notification', {
        notification_type: 'idle_prompt',
        message: 'Agent is waiting for input',
        response_websocket_url: 'ws://localhost:4000/ws',
        timeout: 120
      });

      // 2. Process event
      const hitlRequest = await service.processEvent(event);

      // 3. Verify adapter correctly mapped idle_prompt → QUESTION
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.QUESTION);
      expect(hitlRequest!.question).toBe('Agent is waiting for input');

      // 4. User responds
      const response = createHITLResponse(2, {
        response: 'Continue with the task'
      });
      await service.handleResponse(2, response);

      // 5. Verify status updated
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');
      expect(status.response?.response).toBe('Continue with the task');
    });
  });

  describe('Full Flow: PERMISSION Type', () => {
    test('processes PreToolUse permission request end-to-end', async () => {
      // 1. Create PreToolUse event with permission_mode='ask'
      const event = createHookEvent(3, 'PreToolUse', {
        permission_mode: 'ask',
        tool_name: 'Bash',
        tool_input: {
          command: 'rm -rf /tmp/test'
        },
        response_websocket_url: 'ws://localhost:4000/ws'
      });

      // 2. Process event
      const hitlRequest = await service.processEvent(event);

      // 3. Verify adapter mapped to APPROVAL type
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.APPROVAL);
      expect(hitlRequest!.question).toContain('rm -rf /tmp/test');
      expect(hitlRequest!.context?.tool_name).toBe('Bash');
      expect(hitlRequest!.context?.command).toBe('rm -rf /tmp/test');

      // 4. User approves
      const response = createHITLResponse(3, {
        approved: true,
        comment: 'Looks safe'
      });
      await service.handleResponse(3, response);

      // 5. Verify status callback
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const [eventId, status] = statusUpdateCallback.mock.calls[0];
      expect(eventId).toBe(3);
      expect(status.status).toBe('responded');
      expect(status.response?.approved).toBe(true);
      expect(status.response?.comment).toBe('Looks safe');

      // 6. Verify metrics
      expect(service.getMetrics().totalResponses).toBe(1);
    });

    test('handles Notification permission_prompt (legacy)', async () => {
      // 1. Create notification with permission_prompt type
      const event = createHookEvent(4, 'Notification', {
        notification_type: 'permission_prompt',
        message: 'Allow file write?',
        response_websocket_url: 'ws://localhost:4000/ws',
        context: {
          permission_type: 'file_write',
          file_path: '/etc/config.json'
        }
      });

      // 2. Process event
      const hitlRequest = await service.processEvent(event);

      // 3. Verify adapter mapped permission_prompt → PERMISSION
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.PERMISSION);
      expect(hitlRequest!.question).toBe('Allow file write?');

      // 4. User denies
      const response = createHITLResponse(4, {
        permission: false
      });
      await service.handleResponse(4, response);

      // 5. Verify status
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');
      expect(status.response?.permission).toBe(false);
    });
  });

  describe('Full Flow: CHOICE Type', () => {
    test('processes CHOICE event with multiple options', async () => {
      // 1. Create event with choices
      const event = createHookEvent(5, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'choice',
        question: 'Select deployment environment:',
        choices: ['development', 'staging', 'production'],
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 300
      };

      // 2. Process event
      const hitlRequest = await service.processEvent(event);

      // 3. Verify request
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.CHOICE);
      expect(hitlRequest!.choices).toEqual(['development', 'staging', 'production']);

      // 4. User selects choice
      const response = createHITLResponse(5, {
        choice: 'staging'
      });
      await service.handleResponse(5, response);

      // 5. Verify status
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');
      expect(status.response?.choice).toBe('staging');
    });
  });

  describe('Full Flow: APPROVAL Type', () => {
    test('processes Edit tool approval request', async () => {
      // 1. Create PreToolUse event for Edit tool
      const event = createHookEvent(6, 'PreToolUse', {
        permission_mode: 'ask',
        tool_name: 'Edit',
        tool_input: {
          file_path: '/src/config.ts',
          old_string: 'const DEBUG = false;',
          new_string: 'const DEBUG = true;'
        },
        response_websocket_url: 'ws://localhost:4000/ws'
      });

      // 2. Process event
      const hitlRequest = await service.processEvent(event);

      // 3. Verify request has edit context
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.APPROVAL);
      expect(hitlRequest!.context?.tool_name).toBe('Edit');
      expect(hitlRequest!.context?.file_path).toBe('/src/config.ts');
      expect(hitlRequest!.context?.old_string).toBe('const DEBUG = false;');
      expect(hitlRequest!.context?.new_string).toBe('const DEBUG = true;');

      // 4. User denies with comment
      const response = createHITLResponse(6, {
        approved: false,
        comment: 'DEBUG should remain false in production'
      });
      await service.handleResponse(6, response);

      // 5. Verify status
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');
      expect(status.response?.approved).toBe(false);
      expect(status.response?.comment).toBe('DEBUG should remain false in production');
    });
  });

  describe('Full Flow: QUESTION_INPUT Type', () => {
    test('processes multi-question input request', async () => {
      // 1. Create event with multiple questions
      const event = createHookEvent(7, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question_input',
        question: 'Please provide configuration details:',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        context: {
          questions: [
            { question: 'API endpoint?' },
            { question: 'API key?' },
            { question: 'Timeout (seconds)?' }
          ]
        }
      };

      // 2. Process event
      const hitlRequest = await service.processEvent(event);

      // 3. Verify request
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.QUESTION_INPUT);
      expect(hitlRequest!.context?.questions).toHaveLength(3);

      // 4. User provides single combined answer
      const response = createHITLResponse(7, {
        response: 'https://api.example.com, sk-123456, 30'
      });
      await service.handleResponse(7, response);

      // 5. Verify status
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');
      expect(status.response?.response).toBe('https://api.example.com, sk-123456, 30');
    });

    test('handles user cancellation of question_input', async () => {
      // 1. Create event
      const event = createHookEvent(8, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question_input',
        question: 'Configure database connection:',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };

      // 2. Process event
      await service.processEvent(event);

      // 3. User cancels
      const response = createHITLResponse(8, {
        cancelled: true
      });
      await service.handleResponse(8, response);

      // 4. Verify cancellation recorded
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');
      expect(status.response?.cancelled).toBe(true);
    });
  });

  describe('Timeout Scenarios', () => {
    test('event times out when no response received', async () => {
      // 1. Create event with 1 second timeout
      const event = createHookEvent(9, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Quick question?',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 1 // 1 second
      };

      // 2. Process event
      await service.processEvent(event);

      // 3. Verify pending
      expect(service.getMetrics().pendingRequests).toBe(1);

      // 4. Advance time past timeout
      jest.advanceTimersByTime(1500);

      // 5. Verify timeout was handled
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const [eventId, status] = statusUpdateCallback.mock.calls[0];
      expect(eventId).toBe(9);
      expect(status.status).toBe('timeout');
      expect(status.timeoutAt).toBeDefined();

      // 6. Verify metrics
      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(1);
      expect(metrics.pendingRequests).toBe(0);
    });

    test('late response after timeout is rejected', async () => {
      // 1. Create event with short timeout
      const event = createHookEvent(10, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Fast question?',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 1
      };

      // 2. Process event
      await service.processEvent(event);

      // 3. Let timeout fire
      jest.advanceTimersByTime(1500);

      // 4. Verify timeout fired
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const timeoutStatus = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(timeoutStatus.status).toBe('timeout');

      // 5. Try to respond after timeout
      const response = createHITLResponse(10, { response: 'Too late' });
      const result = await service.handleResponse(10, response);

      // 6. Verify response rejected
      expect(result).toBe(false);

      // 7. Verify no additional status updates
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1); // Still only timeout

      // 8. Verify metrics
      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(1);
      expect(metrics.totalResponses).toBe(0);
    });

    test('timeout does not fire if response received first', async () => {
      // 1. Create event with timeout
      const event = createHookEvent(11, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Will you respond in time?',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 10
      };

      // 2. Process event
      await service.processEvent(event);

      // 3. Advance part-way through timeout
      jest.advanceTimersByTime(5000);

      // 4. User responds before timeout
      const response = createHITLResponse(11, { response: 'Yes!' });
      await service.handleResponse(11, response);

      // 5. Verify response recorded
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');

      // 6. Advance past timeout
      jest.advanceTimersByTime(10000);

      // 7. Verify timeout did NOT fire
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1); // Still only response

      // 8. Verify metrics
      const metrics = service.getMetrics();
      expect(metrics.totalResponses).toBe(1);
      expect(metrics.totalTimeouts).toBe(0);
    });
  });

  describe('Error Scenarios', () => {
    test('rejects event with invalid WebSocket URL', async () => {
      // 1. Create event with disallowed URL (not in whitelist)
      const event = createHookEvent(12, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Malicious question?',
        responseWebSocketUrl: 'ws://evil.com/steal-data',
        timeout: 60
      };

      // 2. Process event
      const result = await service.processEvent(event);

      // 3. Verify event rejected
      expect(result).toBeNull();

      // 4. Verify error metric incremented
      const metrics = service.getMetrics();
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.pendingRequests).toBe(0);
    });

    test('rejects event with non-WebSocket URL', async () => {
      // 1. Create event with HTTP URL instead of WS
      const event = createHookEvent(13, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'HTTP question?',
        responseWebSocketUrl: 'http://localhost:4000/ws',
        timeout: 60
      };

      // 2. Process event
      const result = await service.processEvent(event);

      // 3. Verify rejection
      expect(result).toBeNull();
      expect(service.getMetrics().totalErrors).toBe(1);
    });

    test('handles missing event ID gracefully', async () => {
      // 1. Create event without ID
      const event = createHookEvent(14, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'No ID question?',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };
      delete event.id;

      // 2. Process event
      const result = await service.processEvent(event);

      // 3. Verify rejection
      expect(result).toBeNull();
      expect(service.getMetrics().pendingRequests).toBe(0);
    });

    test('marks event as error explicitly', async () => {
      // 1. Create valid event
      const event = createHookEvent(15, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Will fail?',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };

      // 2. Process event
      await service.processEvent(event);

      // 3. Mark as error
      await service.markAsError(15, 'Network connection failed');

      // 4. Verify status callback
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const [eventId, status] = statusUpdateCallback.mock.calls[0];
      expect(eventId).toBe(15);
      expect(status.status).toBe('error');
      expect(status.errorMessage).toBe('Network connection failed');

      // 5. Verify metrics
      const metrics = service.getMetrics();
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.pendingRequests).toBe(0);
    });
  });

  describe('Legacy Type Support', () => {
    test('maps permission_prompt to PERMISSION type', async () => {
      const event = createHookEvent(16, 'Notification', {
        notification_type: 'permission_prompt',
        message: 'Legacy permission request',
        response_websocket_url: 'ws://localhost:4000/ws'
      });

      const hitlRequest = await service.processEvent(event);

      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.PERMISSION);
    });

    test('maps idle_prompt to QUESTION type', async () => {
      const event = createHookEvent(17, 'Notification', {
        notification_type: 'idle_prompt',
        message: 'Legacy idle prompt',
        response_websocket_url: 'ws://localhost:4000/ws'
      });

      const hitlRequest = await service.processEvent(event);

      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.QUESTION);
    });

    test('handles unknown legacy type gracefully', async () => {
      const event = createHookEvent(18, 'Notification', {
        notification_type: 'unknown_legacy_type',
        message: 'Unknown type',
        response_websocket_url: 'ws://localhost:4000/ws'
      });

      // Should not be recognized as HITL event
      const hitlRequest = await service.processEvent(event);

      expect(hitlRequest).toBeNull();
    });
  });

  describe('Race Conditions', () => {
    test('response wins race with timeout at exact same time', async () => {
      const event = createHookEvent(19, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Race condition test',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 5
      };

      await service.processEvent(event);

      // Advance to exact timeout moment
      jest.advanceTimersByTime(4999);

      // Handle response at almost exact timeout
      const response = createHITLResponse(19, { response: 'Just in time' });
      await service.handleResponse(19, response);

      // Advance past timeout
      jest.advanceTimersByTime(2);

      // Verify only response was recorded
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const status = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');

      const metrics = service.getMetrics();
      expect(metrics.totalResponses).toBe(1);
      expect(metrics.totalTimeouts).toBe(0);
    });

    test('timeout wins race with simultaneous response attempt', async () => {
      const event = createHookEvent(20, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Timeout wins',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 1
      };

      await service.processEvent(event);

      // Let timeout fire
      jest.advanceTimersByTime(1001);

      // Timeout should have fired
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1);
      const timeoutStatus = statusUpdateCallback.mock.calls[0][1] as HITLStatus;
      expect(timeoutStatus.status).toBe('timeout');

      // Try response immediately after
      const response = createHITLResponse(20, { response: 'Too late' });
      const result = await service.handleResponse(20, response);

      // Response should be rejected
      expect(result).toBe(false);
      expect(statusUpdateCallback).toHaveBeenCalledTimes(1); // No second call

      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(1);
      expect(metrics.totalResponses).toBe(0);
    });

    test('multiple concurrent HITL requests handled independently', async () => {
      // Create 3 concurrent events
      const event1 = createHookEvent(21, 'CustomEvent');
      event1.humanInTheLoop = {
        type: 'question',
        question: 'Question 1',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 10
      };

      const event2 = createHookEvent(22, 'CustomEvent');
      event2.humanInTheLoop = {
        type: 'question',
        question: 'Question 2',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 5
      };

      const event3 = createHookEvent(23, 'CustomEvent');
      event3.humanInTheLoop = {
        type: 'question',
        question: 'Question 3',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 15
      };

      // Process all events
      await service.processEvent(event1);
      await service.processEvent(event2);
      await service.processEvent(event3);

      expect(service.getMetrics().pendingRequests).toBe(3);

      // Respond to event 1
      await service.handleResponse(21, createHITLResponse(21, { response: 'Answer 1' }));
      expect(service.getMetrics().pendingRequests).toBe(2);

      // Let event 2 timeout
      jest.advanceTimersByTime(6000);
      expect(service.getMetrics().pendingRequests).toBe(1);

      // Respond to event 3
      await service.handleResponse(23, createHITLResponse(23, { response: 'Answer 3' }));
      expect(service.getMetrics().pendingRequests).toBe(0);

      // Verify final state
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.totalResponses).toBe(2);
      expect(metrics.totalTimeouts).toBe(1);
    });
  });

  describe('Adapter Chain Integration', () => {
    test('DirectHITLAdapter has highest priority', async () => {
      // Event that could match multiple adapters
      const event = createHookEvent(24, 'Notification', {
        notification_type: 'question'
      });

      // Add direct HITL field (should override notification)
      event.humanInTheLoop = {
        type: 'question',
        question: 'Direct HITL question',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };

      const hitlRequest = await service.processEvent(event);

      // Should use DirectHITLAdapter
      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.question).toBe('Direct HITL question');
    });

    test('PreToolUseAdapter processes permission requests', async () => {
      const event = createHookEvent(25, 'PreToolUse', {
        permission_mode: 'ask',
        tool_name: 'Write',
        tool_input: {
          file_path: '/config.json',
          content: '{"debug": true}'
        },
        response_websocket_url: 'ws://localhost:4000/ws'
      });

      const hitlRequest = await service.processEvent(event);

      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.APPROVAL);
      expect(hitlRequest!.question).toContain('/config.json');
      expect(hitlRequest!.context?.tool_name).toBe('Write');
    });

    test('NotificationAdapter handles HITL notification types', async () => {
      const event = createHookEvent(26, 'Notification', {
        notification_type: 'question',
        message: 'Notification question',
        response_websocket_url: 'ws://localhost:4000/ws'
      });

      const hitlRequest = await service.processEvent(event);

      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.QUESTION);
      expect(hitlRequest!.question).toBe('Notification question');
    });

    test('PostToolUseAdapter handles confirmation requests', async () => {
      const event = createHookEvent(27, 'PostToolUse', {
        requires_confirmation: true,
        tool_name: 'Bash',
        confirmation_message: 'Command executed successfully. Proceed?',
        response_websocket_url: 'ws://localhost:4000/ws',
        tool_result: 'Files deleted: 42'
      });

      const hitlRequest = await service.processEvent(event);

      expect(hitlRequest).not.toBeNull();
      expect(hitlRequest!.type).toBe(HITLType.APPROVAL);
      expect(hitlRequest!.question).toContain('Command executed successfully');
      expect(hitlRequest!.context?.tool_result).toBe('Files deleted: 42');
    });

    test('non-HITL events are ignored', async () => {
      const event = createHookEvent(28, 'Notification', {
        notification_type: 'info',
        message: 'Just an info message'
      });

      const hitlRequest = await service.processEvent(event);

      expect(hitlRequest).toBeNull();
      expect(service.getMetrics().totalRequests).toBe(0);
    });
  });

  describe('Metrics and Monitoring', () => {
    test('tracks response time correctly', async () => {
      const event = createHookEvent(29, 'CustomEvent');
      event.humanInTheLoop = {
        type: 'question',
        question: 'Timing test',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };

      await service.processEvent(event);

      // Simulate user thinking for 3 seconds
      jest.advanceTimersByTime(3000);

      await service.handleResponse(29, createHITLResponse(29, { response: 'Answer' }));

      const metrics = service.getMetrics();
      expect(metrics.avgResponseTimeMs).toBeGreaterThan(0);
      expect(metrics.avgResponseTimeMs).toBeCloseTo(3000, -2);
    });

    test('calculates average response time across multiple responses', async () => {
      // Event 1: 1 second response time
      const event1 = createHookEvent(30, 'CustomEvent');
      event1.humanInTheLoop = {
        type: 'question',
        question: 'Q1',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };
      await service.processEvent(event1);
      jest.advanceTimersByTime(1000);
      await service.handleResponse(30, createHITLResponse(30, { response: 'A1' }));

      // Event 2: 5 second response time
      const event2 = createHookEvent(31, 'CustomEvent');
      event2.humanInTheLoop = {
        type: 'question',
        question: 'Q2',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };
      await service.processEvent(event2);
      jest.advanceTimersByTime(5000);
      await service.handleResponse(31, createHITLResponse(31, { response: 'A2' }));

      // Event 3: 3 second response time
      const event3 = createHookEvent(32, 'CustomEvent');
      event3.humanInTheLoop = {
        type: 'question',
        question: 'Q3',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };
      await service.processEvent(event3);
      jest.advanceTimersByTime(3000);
      await service.handleResponse(32, createHITLResponse(32, { response: 'A3' }));

      // Average should be (1000 + 5000 + 3000) / 3 = 3000
      const metrics = service.getMetrics();
      expect(metrics.avgResponseTimeMs).toBeCloseTo(3000, -2);
    });

    test('tracks all metric types correctly', async () => {
      // Request 1: Success
      const event1 = createHookEvent(33, 'CustomEvent');
      event1.humanInTheLoop = {
        type: 'question',
        question: 'Q1',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 10
      };
      await service.processEvent(event1);
      await service.handleResponse(33, createHITLResponse(33, { response: 'A1' }));

      // Request 2: Timeout
      const event2 = createHookEvent(34, 'CustomEvent');
      event2.humanInTheLoop = {
        type: 'question',
        question: 'Q2',
        responseWebSocketUrl: 'ws://localhost:4000/ws',
        timeout: 1
      };
      await service.processEvent(event2);
      jest.advanceTimersByTime(1500);

      // Request 3: Error
      const event3 = createHookEvent(35, 'CustomEvent');
      event3.humanInTheLoop = {
        type: 'question',
        question: 'Q3',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };
      await service.processEvent(event3);
      await service.markAsError(35, 'Test error');

      // Request 4: Pending
      const event4 = createHookEvent(36, 'CustomEvent');
      event4.humanInTheLoop = {
        type: 'question',
        question: 'Q4',
        responseWebSocketUrl: 'ws://localhost:4000/ws'
      };
      await service.processEvent(event4);

      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(4);
      expect(metrics.totalResponses).toBe(1);
      expect(metrics.totalTimeouts).toBe(1);
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.pendingRequests).toBe(1);
    });
  });
});
