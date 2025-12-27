/**
 * HITL Service Tests
 *
 * Comprehensive unit tests for HITLTimeoutManager and HITLService classes.
 * Tests timeout management, event processing, response handling, and metrics.
 */

import { describe, test, expect, beforeEach, afterEach, mock, jest } from 'bun:test';
import { HITLTimeoutManager, HITLService } from '../service';
import type { HITLRequest, HITLResponse, HITLStatus } from '../types';
import { HITLType } from '../types';
import type { HookEvent } from '../../types';
import { HITLAdapterChain } from '../adapters';

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

// Helper function to create mock HookEvent
function createMockEvent(id: number, type: string = 'notification'): HookEvent {
  return {
    id,
    source_app: 'test-app',
    session_id: 'test-session',
    hook_event_type: type,
    payload: {},
    timestamp: Date.now()
  };
}

// Helper function to create mock HITLRequest
function createMockHITLRequest(overrides: Partial<HITLRequest> = {}): HITLRequest {
  return {
    type: HITLType.QUESTION,
    question: 'Test question?',
    responseWebSocketUrl: 'ws://localhost:4000/ws',
    timeout: 60,
    requiresResponse: true,
    ...overrides
  };
}

// Helper function to create mock HITLResponse
function createMockHITLResponse(eventId: number, overrides: Partial<HITLResponse> = {}): HITLResponse {
  return {
    eventId,
    respondedAt: Date.now(),
    response: 'Test answer',
    ...overrides
  };
}

describe('HITLTimeoutManager', () => {
  let manager: HITLTimeoutManager;

  beforeEach(() => {
    manager = new HITLTimeoutManager();
  });

  describe('set()', () => {
    test('creates a timer for valid timeout', () => {
      const callback = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 60, callback);

      expect(manager.has(eventId)).toBe(true);
      expect(manager.size).toBe(1);
    });

    test('does not create timer for timeout <= 0', () => {
      const callback = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 0, callback);
      expect(manager.has(eventId)).toBe(false);
      expect(manager.size).toBe(0);

      manager.set(eventId, -10, callback);
      expect(manager.has(eventId)).toBe(false);
      expect(manager.size).toBe(0);
    });

    test('clears existing timer before setting new one', () => {
      const callback1 = mock(() => {});
      const callback2 = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 60, callback1);
      expect(manager.size).toBe(1);

      manager.set(eventId, 120, callback2);
      expect(manager.size).toBe(1); // Still 1, replaced
      expect(manager.has(eventId)).toBe(true);
    });

    test('can set multiple timers for different events', () => {
      const callback = mock(() => {});

      manager.set(1, 60, callback);
      manager.set(2, 120, callback);
      manager.set(3, 180, callback);

      expect(manager.size).toBe(3);
      expect(manager.has(1)).toBe(true);
      expect(manager.has(2)).toBe(true);
      expect(manager.has(3)).toBe(true);
    });
  });

  describe('clear()', () => {
    test('removes an existing timer', () => {
      const callback = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 60, callback);
      expect(manager.has(eventId)).toBe(true);

      const result = manager.clear(eventId);
      expect(result).toBe(true);
      expect(manager.has(eventId)).toBe(false);
      expect(manager.size).toBe(0);
    });

    test('returns false for non-existent timer', () => {
      const result = manager.clear(999);
      expect(result).toBe(false);
    });

    test('prevents callback from firing after clear', () => {
      const callback = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 1, callback); // 1 second timeout
      manager.clear(eventId);

      // Advance time past timeout
      jest.advanceTimersByTime(2000);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('has()', () => {
    test('returns true for existing timer', () => {
      const callback = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 60, callback);
      expect(manager.has(eventId)).toBe(true);
    });

    test('returns false for non-existent timer', () => {
      expect(manager.has(999)).toBe(false);
    });

    test('returns false after timer is cleared', () => {
      const callback = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 60, callback);
      manager.clear(eventId);
      expect(manager.has(eventId)).toBe(false);
    });
  });

  describe('timer callback', () => {
    test('fires callback after specified timeout', () => {
      const callback = mock(() => {});
      const eventId = 1;
      const timeoutSeconds = 5;

      manager.set(eventId, timeoutSeconds, callback);

      // Advance time just before timeout
      jest.advanceTimersByTime((timeoutSeconds * 1000) - 100);
      expect(callback).not.toHaveBeenCalled();

      // Advance past timeout
      jest.advanceTimersByTime(200);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(eventId);
    });

    test('removes timer from map after firing', () => {
      const callback = mock(() => {});
      const eventId = 1;

      manager.set(eventId, 1, callback);
      expect(manager.has(eventId)).toBe(true);

      jest.advanceTimersByTime(1500);
      expect(callback).toHaveBeenCalled();
      expect(manager.has(eventId)).toBe(false);
    });

    test('handles async callbacks', async () => {
      const asyncCallback = mock(async (id: number) => {
        await new Promise(resolve => setTimeout(resolve, 100));
      });
      const eventId = 1;

      manager.set(eventId, 1, asyncCallback);
      jest.advanceTimersByTime(1500);

      expect(asyncCallback).toHaveBeenCalledWith(eventId);
    });

    test('handles callback errors gracefully', () => {
      const errorCallback = mock(() => {
        throw new Error('Callback error');
      });
      const eventId = 1;

      // Should not throw
      expect(() => {
        manager.set(eventId, 1, errorCallback);
        jest.advanceTimersByTime(1500);
      }).not.toThrow();

      expect(errorCallback).toHaveBeenCalled();
    });
  });

  describe('clearAll()', () => {
    test('removes all timers', () => {
      const callback = mock(() => {});

      manager.set(1, 60, callback);
      manager.set(2, 120, callback);
      manager.set(3, 180, callback);

      expect(manager.size).toBe(3);

      manager.clearAll();

      expect(manager.size).toBe(0);
      expect(manager.has(1)).toBe(false);
      expect(manager.has(2)).toBe(false);
      expect(manager.has(3)).toBe(false);
    });

    test('prevents all callbacks from firing', () => {
      const callback = mock(() => {});

      manager.set(1, 1, callback);
      manager.set(2, 2, callback);
      manager.set(3, 3, callback);

      manager.clearAll();

      jest.advanceTimersByTime(5000);

      expect(callback).not.toHaveBeenCalled();
    });

    test('works when no timers exist', () => {
      expect(() => manager.clearAll()).not.toThrow();
      expect(manager.size).toBe(0);
    });
  });

  describe('size getter', () => {
    test('returns 0 when no timers', () => {
      expect(manager.size).toBe(0);
    });

    test('returns correct count of timers', () => {
      const callback = mock(() => {});

      manager.set(1, 60, callback);
      expect(manager.size).toBe(1);

      manager.set(2, 120, callback);
      expect(manager.size).toBe(2);

      manager.clear(1);
      expect(manager.size).toBe(1);

      manager.clearAll();
      expect(manager.size).toBe(0);
    });
  });
});

describe('HITLService', () => {
  let service: HITLService;
  let mockAdapterChain: HITLAdapterChain;

  beforeEach(() => {
    // Create mock adapter chain
    mockAdapterChain = {
      tryAdapt: mock(() => null),
      isHITLEvent: mock(() => false)
    } as any;

    service = new HITLService(mockAdapterChain);
  });

  afterEach(() => {
    service.shutdown();
  });

  describe('processEvent()', () => {
    test('adapts event to HITLRequest using adapter chain', async () => {
      const event = createMockEvent(1, 'notification');
      const expectedRequest = createMockHITLRequest();

      mockAdapterChain.tryAdapt = mock(() => expectedRequest);

      const result = await service.processEvent(event);

      expect(mockAdapterChain.tryAdapt).toHaveBeenCalledWith(event);
      expect(result).toEqual(expectedRequest);
    });

    test('returns null when adapter chain returns null', async () => {
      const event = createMockEvent(1);
      mockAdapterChain.tryAdapt = mock(() => null);

      const result = await service.processEvent(event);

      expect(result).toBeNull();
    });

    test('returns null when event has no ID', async () => {
      const event = createMockEvent(1);
      delete event.id;

      const expectedRequest = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => expectedRequest);

      const result = await service.processEvent(event);

      expect(result).toBeNull();
    });

    test('sets timeout for the request', async () => {
      const event = createMockEvent(1);
      const expectedRequest = createMockHITLRequest({ timeout: 120 });

      mockAdapterChain.tryAdapt = mock(() => expectedRequest);

      await service.processEvent(event);

      // Verify timeout was set by checking internal state
      const metrics = service.getMetrics();
      expect(metrics.pendingRequests).toBe(1);
    });

    test('stores request in pendingRequests', async () => {
      const event = createMockEvent(1);
      const expectedRequest = createMockHITLRequest();

      mockAdapterChain.tryAdapt = mock(() => expectedRequest);

      await service.processEvent(event);

      const metrics = service.getMetrics();
      expect(metrics.pendingRequests).toBe(1);
    });

    test('increments totalRequests metric', async () => {
      const event1 = createMockEvent(1);
      const event2 = createMockEvent(2);
      const request = createMockHITLRequest();

      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event1);
      let metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(1);

      await service.processEvent(event2);
      metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(2);
    });

    test('returns null for invalid WebSocket URL', async () => {
      const event = createMockEvent(1);
      const requestWithBadUrl = createMockHITLRequest({
        responseWebSocketUrl: 'http://evil.com'
      });

      mockAdapterChain.tryAdapt = mock(() => requestWithBadUrl);

      const result = await service.processEvent(event);

      expect(result).toBeNull();

      const metrics = service.getMetrics();
      expect(metrics.totalErrors).toBe(1);
      expect(metrics.pendingRequests).toBe(0);
    });

    test('uses default timeout when not specified', async () => {
      const event = createMockEvent(1);
      const requestWithoutTimeout = createMockHITLRequest();
      delete requestWithoutTimeout.timeout;

      mockAdapterChain.tryAdapt = mock(() => requestWithoutTimeout);

      const result = await service.processEvent(event);

      expect(result).toEqual(requestWithoutTimeout);

      const metrics = service.getMetrics();
      expect(metrics.pendingRequests).toBe(1);
    });
  });

  describe('handleResponse()', () => {
    test('clears timeout for event', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      const response = createMockHITLResponse(1);
      await service.handleResponse(1, response);

      // Advance time past timeout - callback should not fire
      jest.advanceTimersByTime(70000);

      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(0);
    });

    test('removes event from pendingRequests', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);
      expect(service.getMetrics().pendingRequests).toBe(1);

      const response = createMockHITLResponse(1);
      await service.handleResponse(1, response);

      expect(service.getMetrics().pendingRequests).toBe(0);
    });

    test('returns false for unknown eventId', async () => {
      const response = createMockHITLResponse(999);
      const result = await service.handleResponse(999, response);

      expect(result).toBe(false);
    });

    test('increments totalResponses metric', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      const response = createMockHITLResponse(1);
      await service.handleResponse(1, response);

      const metrics = service.getMetrics();
      expect(metrics.totalResponses).toBe(1);
    });

    test('calls statusUpdateCallback with correct status', async () => {
      const statusCallback = mock(async () => {});
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      const response = createMockHITLResponse(1);
      await service.handleResponse(1, response);

      expect(statusCallback).toHaveBeenCalledTimes(1);

      const callArgs = statusCallback.mock.calls[0];
      expect(callArgs[0]).toBe(1); // eventId

      const status = callArgs[1] as HITLStatus;
      expect(status.status).toBe('responded');
      expect(status.response).toEqual(response);
      expect(status.respondedAt).toBe(response.respondedAt);
    });

    test('handles statusUpdateCallback errors', async () => {
      const statusCallback = mock(async () => {
        throw new Error('Status update failed');
      });
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      const response = createMockHITLResponse(1);
      const result = await service.handleResponse(1, response);

      expect(result).toBe(false);
      expect(service.getMetrics().totalErrors).toBe(1);
    });

    test('calculates and records response time', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      // Advance time to simulate user thinking
      jest.advanceTimersByTime(5000); // 5 seconds

      const response = createMockHITLResponse(1);
      await service.handleResponse(1, response);

      const metrics = service.getMetrics();
      expect(metrics.avgResponseTimeMs).toBeGreaterThan(0);
    });

    test('returns true on successful response handling', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      const response = createMockHITLResponse(1);
      const result = await service.handleResponse(1, response);

      expect(result).toBe(true);
    });
  });

  describe('handleTimeout()', () => {
    test('updates status to timeout after timeout expires', async () => {
      const statusCallback = mock(async () => {});
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest({ timeout: 2 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      // Advance time past timeout
      jest.advanceTimersByTime(3000);

      expect(statusCallback).toHaveBeenCalledTimes(1);

      const callArgs = statusCallback.mock.calls[0];
      expect(callArgs[0]).toBe(1); // eventId

      const status = callArgs[1] as HITLStatus;
      expect(status.status).toBe('timeout');
      expect(status.timeoutAt).toBeDefined();
    });

    test('removes event from pendingRequests', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest({ timeout: 1 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);
      expect(service.getMetrics().pendingRequests).toBe(1);

      jest.advanceTimersByTime(2000);

      expect(service.getMetrics().pendingRequests).toBe(0);
    });

    test('increments totalTimeouts metric', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest({ timeout: 1 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      jest.advanceTimersByTime(2000);

      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(1);
    });

    test('does not fire if response received first', async () => {
      const statusCallback = mock(async () => {});
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest({ timeout: 5 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      // Handle response before timeout
      jest.advanceTimersByTime(2000);
      const response = createMockHITLResponse(1);
      await service.handleResponse(1, response);

      // Advance past timeout
      jest.advanceTimersByTime(5000);

      // Should only be called once (for response, not timeout)
      expect(statusCallback).toHaveBeenCalledTimes(1);

      const status = statusCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');

      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(0);
      expect(metrics.totalResponses).toBe(1);
    });
  });

  describe('markAsError()', () => {
    test('updates status to error', async () => {
      const statusCallback = mock(async () => {});
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);
      await service.markAsError(1, 'Test error');

      expect(statusCallback).toHaveBeenCalledTimes(1);

      const callArgs = statusCallback.mock.calls[0];
      expect(callArgs[0]).toBe(1);

      const status = callArgs[1] as HITLStatus;
      expect(status.status).toBe('error');
      expect(status.errorMessage).toBe('Test error');
    });

    test('clears timeout', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest({ timeout: 10 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);
      await service.markAsError(1, 'Test error');

      // Advance past timeout
      jest.advanceTimersByTime(15000);

      // Should not fire timeout callback
      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(0);
    });

    test('removes from pendingRequests', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);
      expect(service.getMetrics().pendingRequests).toBe(1);

      await service.markAsError(1, 'Test error');

      expect(service.getMetrics().pendingRequests).toBe(0);
    });

    test('increments totalErrors metric', async () => {
      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);
      await service.markAsError(1, 'Test error');

      const metrics = service.getMetrics();
      expect(metrics.totalErrors).toBe(1);
    });

    test('handles statusCallback errors gracefully', async () => {
      const statusCallback = mock(async () => {
        throw new Error('Callback error');
      });
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      // Should not throw - method handles error internally
      await service.markAsError(1, 'Test error');

      // Verify callback was called even though it threw
      expect(statusCallback).toHaveBeenCalled();
    });
  });

  describe('getMetrics()', () => {
    test('returns correct initial metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics).toEqual({
        totalRequests: 0,
        totalResponses: 0,
        totalTimeouts: 0,
        totalErrors: 0,
        avgResponseTimeMs: 0,
        pendingRequests: 0,
        deliveredCount: 0,
        failedDeliveryCount: 0,
        pendingPollCount: 0
      });
    });

    test('returns correct metrics after processing events', async () => {
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.processEvent(createMockEvent(2));
      await service.processEvent(createMockEvent(3));

      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.pendingRequests).toBe(3);
    });

    test('returns correct metrics after responses', async () => {
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.processEvent(createMockEvent(2));

      await service.handleResponse(1, createMockHITLResponse(1));

      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalResponses).toBe(1);
      expect(metrics.pendingRequests).toBe(1);
    });

    test('returns correct metrics after timeouts', async () => {
      const request = createMockHITLRequest({ timeout: 1 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.processEvent(createMockEvent(2));

      jest.advanceTimersByTime(2000);

      const metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalTimeouts).toBe(2);
      expect(metrics.pendingRequests).toBe(0);
    });

    test('calculates average response time correctly', async () => {
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      // Process 3 events with different response times
      await service.processEvent(createMockEvent(1));
      jest.advanceTimersByTime(1000); // 1s
      await service.handleResponse(1, createMockHITLResponse(1));

      await service.processEvent(createMockEvent(2));
      jest.advanceTimersByTime(3000); // 3s
      await service.handleResponse(2, createMockHITLResponse(2));

      await service.processEvent(createMockEvent(3));
      jest.advanceTimersByTime(2000); // 2s
      await service.handleResponse(3, createMockHITLResponse(3));

      const metrics = service.getMetrics();
      // Average should be around (1000 + 3000 + 2000) / 3 = 2000ms
      expect(metrics.avgResponseTimeMs).toBeCloseTo(2000, -2);
    });

    test('returns a copy of metrics (not reference)', () => {
      const metrics1 = service.getMetrics();
      const metrics2 = service.getMetrics();

      expect(metrics1).toEqual(metrics2);
      expect(metrics1).not.toBe(metrics2); // Different objects
    });
  });

  describe('shutdown()', () => {
    test('clears all pending requests', async () => {
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.processEvent(createMockEvent(2));
      await service.processEvent(createMockEvent(3));

      expect(service.getMetrics().pendingRequests).toBe(3);

      service.shutdown();

      // After shutdown, responses should fail because requests are cleared
      const result = await service.handleResponse(1, createMockHITLResponse(1));
      expect(result).toBe(false);
    });

    test('clears all timers', async () => {
      const request = createMockHITLRequest({ timeout: 10 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.processEvent(createMockEvent(2));

      service.shutdown();

      // Advance past timeout
      jest.advanceTimersByTime(15000);

      // No timeouts should fire
      const metrics = service.getMetrics();
      expect(metrics.totalTimeouts).toBe(0);
    });

    test('can be called multiple times safely', () => {
      expect(() => {
        service.shutdown();
        service.shutdown();
        service.shutdown();
      }).not.toThrow();
    });

    test('can be called on empty service', () => {
      const newService = new HITLService(mockAdapterChain);
      expect(() => newService.shutdown()).not.toThrow();
    });
  });

  describe('setStatusUpdateCallback()', () => {
    test('sets callback that is called on response', async () => {
      const callback = mock(async () => {});
      service.setStatusUpdateCallback(callback);

      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.handleResponse(1, createMockHITLResponse(1));

      expect(callback).toHaveBeenCalledTimes(1);
    });

    test('can replace callback', async () => {
      const callback1 = mock(async () => {});
      const callback2 = mock(async () => {});

      service.setStatusUpdateCallback(callback1);
      service.setStatusUpdateCallback(callback2);

      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.handleResponse(1, createMockHITLResponse(1));

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('isHITLEvent()', () => {
    test('delegates to adapter chain', () => {
      const event = createMockEvent(1);
      mockAdapterChain.isHITLEvent = mock(() => true);

      const result = service.isHITLEvent(event);

      expect(mockAdapterChain.isHITLEvent).toHaveBeenCalledWith(event);
      expect(result).toBe(true);
    });
  });

  describe('resetMetrics()', () => {
    test('resets all metrics to initial state', async () => {
      const request = createMockHITLRequest({ timeout: 1 });
      mockAdapterChain.tryAdapt = mock(() => request);

      // Generate some activity
      await service.processEvent(createMockEvent(1));
      await service.processEvent(createMockEvent(2));
      await service.handleResponse(1, createMockHITLResponse(1));
      jest.advanceTimersByTime(2000); // Trigger timeout for event 2
      await service.markAsError(999, 'Test');

      let metrics = service.getMetrics();
      expect(metrics.totalRequests).toBeGreaterThan(0);
      expect(metrics.totalResponses).toBeGreaterThan(0);
      expect(metrics.totalTimeouts).toBeGreaterThan(0);
      expect(metrics.totalErrors).toBeGreaterThan(0);

      service.resetMetrics();

      metrics = service.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalResponses).toBe(0);
      expect(metrics.totalTimeouts).toBe(0);
      expect(metrics.totalErrors).toBe(0);
      expect(metrics.avgResponseTimeMs).toBe(0);
    });

    test('preserves current pendingRequests count', async () => {
      const request = createMockHITLRequest();
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(createMockEvent(1));
      await service.processEvent(createMockEvent(2));

      expect(service.getMetrics().pendingRequests).toBe(2);

      service.resetMetrics();

      const metrics = service.getMetrics();
      expect(metrics.pendingRequests).toBe(2); // Should be preserved
    });
  });

  describe('race conditions', () => {
    test('response wins race with timeout', async () => {
      const statusCallback = mock(async () => {});
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest({ timeout: 5 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      // Advance close to timeout
      jest.advanceTimersByTime(4999);

      // Handle response just before timeout
      await service.handleResponse(1, createMockHITLResponse(1));

      // Advance past timeout
      jest.advanceTimersByTime(100);

      // Should only have one status update (response)
      expect(statusCallback).toHaveBeenCalledTimes(1);
      const status = statusCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('responded');

      const metrics = service.getMetrics();
      expect(metrics.totalResponses).toBe(1);
      expect(metrics.totalTimeouts).toBe(0);
    });

    test('timeout wins race with late response', async () => {
      const statusCallback = mock(async () => {});
      service.setStatusUpdateCallback(statusCallback);

      const event = createMockEvent(1);
      const request = createMockHITLRequest({ timeout: 1 });
      mockAdapterChain.tryAdapt = mock(() => request);

      await service.processEvent(event);

      // Let timeout fire
      jest.advanceTimersByTime(2000);

      expect(statusCallback).toHaveBeenCalledTimes(1);
      let status = statusCallback.mock.calls[0][1] as HITLStatus;
      expect(status.status).toBe('timeout');

      // Try to handle response after timeout
      const result = await service.handleResponse(1, createMockHITLResponse(1));

      expect(result).toBe(false);
      expect(statusCallback).toHaveBeenCalledTimes(1); // No additional call

      const metrics = service.getMetrics();
      expect(metrics.totalResponses).toBe(0);
      expect(metrics.totalTimeouts).toBe(1);
    });
  });
});
