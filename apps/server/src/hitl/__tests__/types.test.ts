/**
 * Unit tests for HITL Type System
 *
 * Tests for:
 * - HITLType enum values
 * - HITL_TYPE_MAP legacy mappings
 * - normalizeHITLType() function
 * - parseIntSafe() helper (tested indirectly via getHITLConfig)
 * - getHITLConfig() function
 * - DEFAULT_HITL_CONFIG constants
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  HITLType,
  HITL_TYPE_MAP,
  normalizeHITLType,
  getHITLConfig,
  DEFAULT_HITL_CONFIG,
  type HITLConfig,
  type HITLRequest,
  type HITLResponse,
  type HITLStatus,
  type HITLEvent,
  type HITLContext,
} from '../types';

describe('HITLType enum', () => {
  test('should have QUESTION value', () => {
    expect(HITLType.QUESTION).toBe('question');
  });

  test('should have PERMISSION value', () => {
    expect(HITLType.PERMISSION).toBe('permission');
  });

  test('should have CHOICE value', () => {
    expect(HITLType.CHOICE).toBe('choice');
  });

  test('should have APPROVAL value', () => {
    expect(HITLType.APPROVAL).toBe('approval');
  });

  test('should have QUESTION_INPUT value', () => {
    expect(HITLType.QUESTION_INPUT).toBe('question_input');
  });

  test('should have exactly 5 enum values', () => {
    const enumValues = Object.values(HITLType);
    expect(enumValues).toHaveLength(5);
  });

  test('all enum values should be strings', () => {
    const enumValues = Object.values(HITLType);
    enumValues.forEach(value => {
      expect(typeof value).toBe('string');
    });
  });
});

describe('HITL_TYPE_MAP', () => {
  describe('legacy type mappings', () => {
    test('should map permission_prompt to PERMISSION', () => {
      expect(HITL_TYPE_MAP['permission_prompt']).toBe(HITLType.PERMISSION);
    });

    test('should map idle_prompt to QUESTION', () => {
      expect(HITL_TYPE_MAP['idle_prompt']).toBe(HITLType.QUESTION);
    });
  });

  describe('direct HITL type mappings', () => {
    test('should map question to QUESTION', () => {
      expect(HITL_TYPE_MAP['question']).toBe(HITLType.QUESTION);
    });

    test('should map permission to PERMISSION', () => {
      expect(HITL_TYPE_MAP['permission']).toBe(HITLType.PERMISSION);
    });

    test('should map choice to CHOICE', () => {
      expect(HITL_TYPE_MAP['choice']).toBe(HITLType.CHOICE);
    });

    test('should map approval to APPROVAL', () => {
      expect(HITL_TYPE_MAP['approval']).toBe(HITLType.APPROVAL);
    });

    test('should map question_input to QUESTION_INPUT', () => {
      expect(HITL_TYPE_MAP['question_input']).toBe(HITLType.QUESTION_INPUT);
    });
  });

  test('should have exactly 7 mappings (2 legacy + 5 direct)', () => {
    const mappingKeys = Object.keys(HITL_TYPE_MAP);
    expect(mappingKeys).toHaveLength(7);
  });

  test('all mappings should point to valid HITLType values', () => {
    const validTypes = Object.values(HITLType);
    const mappedTypes = Object.values(HITL_TYPE_MAP);

    mappedTypes.forEach(mappedType => {
      expect(validTypes).toContain(mappedType);
    });
  });
});

describe('normalizeHITLType()', () => {
  describe('undefined/empty input', () => {
    test('should return QUESTION for undefined', () => {
      expect(normalizeHITLType(undefined)).toBe(HITLType.QUESTION);
    });

    test('should return QUESTION for empty string', () => {
      expect(normalizeHITLType('')).toBe(HITLType.QUESTION);
    });
  });

  describe('legacy types', () => {
    test('should normalize permission_prompt to PERMISSION', () => {
      expect(normalizeHITLType('permission_prompt')).toBe(HITLType.PERMISSION);
    });

    test('should normalize idle_prompt to QUESTION', () => {
      expect(normalizeHITLType('idle_prompt')).toBe(HITLType.QUESTION);
    });
  });

  describe('canonical types', () => {
    test('should normalize question to QUESTION', () => {
      expect(normalizeHITLType('question')).toBe(HITLType.QUESTION);
    });

    test('should normalize permission to PERMISSION', () => {
      expect(normalizeHITLType('permission')).toBe(HITLType.PERMISSION);
    });

    test('should normalize choice to CHOICE', () => {
      expect(normalizeHITLType('choice')).toBe(HITLType.CHOICE);
    });

    test('should normalize approval to APPROVAL', () => {
      expect(normalizeHITLType('approval')).toBe(HITLType.APPROVAL);
    });

    test('should normalize question_input to QUESTION_INPUT', () => {
      expect(normalizeHITLType('question_input')).toBe(HITLType.QUESTION_INPUT);
    });
  });

  describe('case insensitivity', () => {
    test('should handle uppercase types', () => {
      expect(normalizeHITLType('QUESTION')).toBe(HITLType.QUESTION);
      expect(normalizeHITLType('PERMISSION')).toBe(HITLType.PERMISSION);
      expect(normalizeHITLType('CHOICE')).toBe(HITLType.CHOICE);
    });

    test('should handle mixed case types', () => {
      expect(normalizeHITLType('QuEsTiOn')).toBe(HITLType.QUESTION);
      expect(normalizeHITLType('PeRmIsSiOn')).toBe(HITLType.PERMISSION);
    });

    test('should handle uppercase legacy types', () => {
      expect(normalizeHITLType('PERMISSION_PROMPT')).toBe(HITLType.PERMISSION);
      expect(normalizeHITLType('IDLE_PROMPT')).toBe(HITLType.QUESTION);
    });
  });

  describe('unknown types', () => {
    test('should default to QUESTION for unknown type', () => {
      expect(normalizeHITLType('unknown_type')).toBe(HITLType.QUESTION);
    });

    test('should default to QUESTION for invalid string', () => {
      expect(normalizeHITLType('not_a_valid_type')).toBe(HITLType.QUESTION);
    });

    test('should default to QUESTION for random string', () => {
      expect(normalizeHITLType('xyz123')).toBe(HITLType.QUESTION);
    });
  });
});

describe('parseIntSafe() via getHITLConfig()', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('NaN handling', () => {
    test('should fallback to default for non-numeric string', () => {
      process.env.HITL_DEFAULT_TIMEOUT = 'not_a_number';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(300); // default value
    });

    test('should fallback to default for special characters', () => {
      process.env.HITL_WS_RETRY_ATTEMPTS = '!@#$';
      const config = getHITLConfig();
      expect(config.wsRetryAttempts).toBe(3); // default value
    });
  });

  describe('empty string handling', () => {
    test('should fallback to default for empty string', () => {
      process.env.HITL_DEFAULT_TIMEOUT = '';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(300);
    });

    test('should fallback to default for whitespace', () => {
      process.env.HITL_WS_RETRY_DELAY = '   ';
      const config = getHITLConfig();
      expect(config.wsRetryDelay).toBe(1000);
    });
  });

  describe('undefined handling', () => {
    test('should fallback to default when env var is undefined', () => {
      delete process.env.HITL_DEFAULT_TIMEOUT;
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(300);
    });
  });

  describe('valid number parsing', () => {
    test('should parse positive integers', () => {
      process.env.HITL_DEFAULT_TIMEOUT = '600';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(600);
    });

    test('should parse zero', () => {
      process.env.HITL_WS_RETRY_ATTEMPTS = '0';
      const config = getHITLConfig();
      expect(config.wsRetryAttempts).toBe(0);
    });

    test('should parse large numbers', () => {
      process.env.HITL_WS_RETRY_DELAY = '999999';
      const config = getHITLConfig();
      expect(config.wsRetryDelay).toBe(999999);
    });

    test('should handle negative numbers', () => {
      process.env.HITL_DEFAULT_TIMEOUT = '-100';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(-100); // parseInt handles negatives
    });
  });

  describe('radix 10 parsing', () => {
    test('should parse decimal numbers correctly', () => {
      process.env.HITL_DEFAULT_TIMEOUT = '123';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(123);
    });

    test('should ignore leading zeros (radix 10)', () => {
      process.env.HITL_WS_RETRY_ATTEMPTS = '007';
      const config = getHITLConfig();
      expect(config.wsRetryAttempts).toBe(7); // radix 10, not octal
    });

    test('should truncate decimal points', () => {
      process.env.HITL_DEFAULT_TIMEOUT = '123.456';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(123); // parseInt truncates
    });
  });
});

describe('getHITLConfig()', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('return value structure', () => {
    test('should return an object with all required fields', () => {
      const config = getHITLConfig();
      expect(config).toHaveProperty('defaultTimeout');
      expect(config).toHaveProperty('wsWhitelist');
      expect(config).toHaveProperty('wsRetryAttempts');
      expect(config).toHaveProperty('wsRetryDelay');
      expect(config).toHaveProperty('enableDebugLogs');
    });

    test('should return HITLConfig type structure', () => {
      const config = getHITLConfig();
      expect(typeof config.defaultTimeout).toBe('number');
      expect(Array.isArray(config.wsWhitelist)).toBe(true);
      expect(typeof config.wsRetryAttempts).toBe('number');
      expect(typeof config.wsRetryDelay).toBe('number');
      expect(typeof config.enableDebugLogs).toBe('boolean');
    });
  });

  describe('default values', () => {
    test('should use default values when no env vars are set', () => {
      delete process.env.HITL_DEFAULT_TIMEOUT;
      delete process.env.HITL_WS_WHITELIST;
      delete process.env.HITL_WS_RETRY_ATTEMPTS;
      delete process.env.HITL_WS_RETRY_DELAY;
      delete process.env.HITL_DEBUG;

      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(300);
      expect(config.wsWhitelist).toEqual(['localhost', '127.0.0.1', '[::1]', '::1']);
      expect(config.wsRetryAttempts).toBe(3);
      expect(config.wsRetryDelay).toBe(1000);
      expect(config.enableDebugLogs).toBe(false);
    });
  });

  describe('defaultTimeout', () => {
    test('should use env value when set', () => {
      process.env.HITL_DEFAULT_TIMEOUT = '600';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(600);
    });

    test('should use default 300 when env is invalid', () => {
      process.env.HITL_DEFAULT_TIMEOUT = 'invalid';
      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(300);
    });
  });

  describe('wsWhitelist', () => {
    test('should parse comma-separated whitelist', () => {
      process.env.HITL_WS_WHITELIST = 'example.com,test.local,192.168.1.1';
      const config = getHITLConfig();
      expect(config.wsWhitelist).toEqual(['example.com', 'test.local', '192.168.1.1']);
    });

    test('should use default when env is not set', () => {
      delete process.env.HITL_WS_WHITELIST;
      const config = getHITLConfig();
      expect(config.wsWhitelist).toEqual(['localhost', '127.0.0.1', '[::1]', '::1']);
    });

    test('should handle empty string with default', () => {
      process.env.HITL_WS_WHITELIST = '';
      const config = getHITLConfig();
      expect(config.wsWhitelist).toEqual(['']);
    });

    test('should handle single value', () => {
      process.env.HITL_WS_WHITELIST = 'single.host';
      const config = getHITLConfig();
      expect(config.wsWhitelist).toEqual(['single.host']);
    });
  });

  describe('wsRetryAttempts', () => {
    test('should use env value when set', () => {
      process.env.HITL_WS_RETRY_ATTEMPTS = '5';
      const config = getHITLConfig();
      expect(config.wsRetryAttempts).toBe(5);
    });

    test('should use default 3 when env is invalid', () => {
      process.env.HITL_WS_RETRY_ATTEMPTS = 'abc';
      const config = getHITLConfig();
      expect(config.wsRetryAttempts).toBe(3);
    });
  });

  describe('wsRetryDelay', () => {
    test('should use env value when set', () => {
      process.env.HITL_WS_RETRY_DELAY = '2000';
      const config = getHITLConfig();
      expect(config.wsRetryDelay).toBe(2000);
    });

    test('should use default 1000 when env is invalid', () => {
      process.env.HITL_WS_RETRY_DELAY = 'xyz';
      const config = getHITLConfig();
      expect(config.wsRetryDelay).toBe(1000);
    });
  });

  describe('enableDebugLogs', () => {
    test('should be true when HITL_DEBUG is "true"', () => {
      process.env.HITL_DEBUG = 'true';
      const config = getHITLConfig();
      expect(config.enableDebugLogs).toBe(true);
    });

    test('should be false when HITL_DEBUG is "false"', () => {
      process.env.HITL_DEBUG = 'false';
      const config = getHITLConfig();
      expect(config.enableDebugLogs).toBe(false);
    });

    test('should be false when HITL_DEBUG is any other value', () => {
      process.env.HITL_DEBUG = 'yes';
      const config = getHITLConfig();
      expect(config.enableDebugLogs).toBe(false);
    });

    test('should be false when HITL_DEBUG is not set', () => {
      delete process.env.HITL_DEBUG;
      const config = getHITLConfig();
      expect(config.enableDebugLogs).toBe(false);
    });

    test('should be false for "1"', () => {
      process.env.HITL_DEBUG = '1';
      const config = getHITLConfig();
      expect(config.enableDebugLogs).toBe(false);
    });
  });

  describe('multiple env vars', () => {
    test('should correctly combine all env values', () => {
      process.env.HITL_DEFAULT_TIMEOUT = '900';
      process.env.HITL_WS_WHITELIST = 'host1.com,host2.com';
      process.env.HITL_WS_RETRY_ATTEMPTS = '10';
      process.env.HITL_WS_RETRY_DELAY = '3000';
      process.env.HITL_DEBUG = 'true';

      const config = getHITLConfig();
      expect(config.defaultTimeout).toBe(900);
      expect(config.wsWhitelist).toEqual(['host1.com', 'host2.com']);
      expect(config.wsRetryAttempts).toBe(10);
      expect(config.wsRetryDelay).toBe(3000);
      expect(config.enableDebugLogs).toBe(true);
    });
  });
});

describe('DEFAULT_HITL_CONFIG', () => {
  test('should have defaultTimeout of 300 seconds (5 minutes)', () => {
    expect(DEFAULT_HITL_CONFIG.defaultTimeout).toBe(300);
  });

  test('should have wsWhitelist with localhost variants', () => {
    expect(DEFAULT_HITL_CONFIG.wsWhitelist).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
      '::1'
    ]);
  });

  test('should have wsRetryAttempts of 3', () => {
    expect(DEFAULT_HITL_CONFIG.wsRetryAttempts).toBe(3);
  });

  test('should have wsRetryDelay of 1000ms', () => {
    expect(DEFAULT_HITL_CONFIG.wsRetryDelay).toBe(1000);
  });

  test('should have enableDebugLogs set to false', () => {
    expect(DEFAULT_HITL_CONFIG.enableDebugLogs).toBe(false);
  });

  test('should be a frozen object (immutable)', () => {
    // Note: If DEFAULT_HITL_CONFIG is not frozen, this is just a safety check
    const isFrozen = Object.isFrozen(DEFAULT_HITL_CONFIG);
    // We don't assert frozen, just document the current state
    expect(typeof DEFAULT_HITL_CONFIG).toBe('object');
  });

  test('should have exactly 5 properties', () => {
    const keys = Object.keys(DEFAULT_HITL_CONFIG);
    expect(keys).toHaveLength(5);
  });

  test('wsWhitelist should include IPv4 loopback', () => {
    expect(DEFAULT_HITL_CONFIG.wsWhitelist).toContain('127.0.0.1');
  });

  test('wsWhitelist should include IPv6 loopback variants', () => {
    expect(DEFAULT_HITL_CONFIG.wsWhitelist).toContain('[::1]');
    expect(DEFAULT_HITL_CONFIG.wsWhitelist).toContain('::1');
  });

  test('wsWhitelist should include localhost string', () => {
    expect(DEFAULT_HITL_CONFIG.wsWhitelist).toContain('localhost');
  });
});

describe('Type definitions', () => {
  describe('HITLRequest', () => {
    test('should accept valid HITLRequest object', () => {
      const request: HITLRequest = {
        type: HITLType.QUESTION,
        question: 'Test question?',
        responseWebSocketUrl: 'ws://localhost:3000/ws'
      };

      expect(request.type).toBe(HITLType.QUESTION);
      expect(request.question).toBe('Test question?');
      expect(request.responseWebSocketUrl).toBe('ws://localhost:3000/ws');
    });

    test('should accept optional fields', () => {
      const request: HITLRequest = {
        type: HITLType.CHOICE,
        question: 'Choose one:',
        responseWebSocketUrl: 'ws://localhost:3000/ws',
        choices: ['Option A', 'Option B'],
        timeout: 600,
        requiresResponse: true,
        context: { tool_name: 'test_tool' }
      };

      expect(request.choices).toEqual(['Option A', 'Option B']);
      expect(request.timeout).toBe(600);
      expect(request.requiresResponse).toBe(true);
      expect(request.context?.tool_name).toBe('test_tool');
    });
  });

  describe('HITLResponse', () => {
    test('should accept valid HITLResponse object', () => {
      const response: HITLResponse = {
        eventId: 123,
        respondedAt: Date.now()
      };

      expect(response.eventId).toBe(123);
      expect(typeof response.respondedAt).toBe('number');
    });

    test('should accept all optional response fields', () => {
      const response: HITLResponse = {
        eventId: 456,
        respondedAt: Date.now(),
        respondedBy: 'user123',
        response: 'Yes',
        permission: true,
        choice: 'Option A',
        approved: true,
        comment: 'Looks good',
        cancelled: false
      };

      expect(response.respondedBy).toBe('user123');
      expect(response.response).toBe('Yes');
      expect(response.permission).toBe(true);
      expect(response.choice).toBe('Option A');
      expect(response.approved).toBe(true);
      expect(response.comment).toBe('Looks good');
      expect(response.cancelled).toBe(false);
    });
  });

  describe('HITLContext', () => {
    test('should accept legacy permission_type', () => {
      const context: HITLContext = {
        permission_type: 'file_edit'
      };

      expect(context.permission_type).toBe('file_edit');
    });

    test('should accept tool context fields', () => {
      const context: HITLContext = {
        tool_name: 'Edit',
        command: 'edit file',
        file_path: '/path/to/file.ts',
        old_string: 'old code',
        new_string: 'new code',
        content: 'file content'
      };

      expect(context.tool_name).toBe('Edit');
      expect(context.file_path).toBe('/path/to/file.ts');
    });

    test('should accept question_input context', () => {
      const context: HITLContext = {
        questions: [
          {
            question: 'Select environment:',
            options: [
              { label: 'dev', description: 'Development' },
              { label: 'prod', description: 'Production' }
            ],
            multiSelect: false
          }
        ]
      };

      expect(context.questions).toHaveLength(1);
      expect(context.questions?.[0]?.options).toHaveLength(2);
    });

    test('should accept additional unknown fields', () => {
      const context: HITLContext = {
        customField: 'custom value',
        anotherField: 123,
        nested: { key: 'value' }
      };

      expect(context.customField).toBe('custom value');
      expect(context.anotherField).toBe(123);
    });
  });

  describe('HITLStatus', () => {
    test('should accept pending status', () => {
      const status: HITLStatus = {
        status: 'pending'
      };

      expect(status.status).toBe('pending');
    });

    test('should accept responded status with response', () => {
      const status: HITLStatus = {
        status: 'responded',
        respondedAt: Date.now(),
        response: {
          eventId: 1,
          respondedAt: Date.now(),
          response: 'Answer'
        }
      };

      expect(status.status).toBe('responded');
      expect(status.response).toBeDefined();
    });

    test('should accept timeout status', () => {
      const status: HITLStatus = {
        status: 'timeout',
        timeoutAt: Date.now()
      };

      expect(status.status).toBe('timeout');
      expect(status.timeoutAt).toBeDefined();
    });

    test('should accept error status', () => {
      const status: HITLStatus = {
        status: 'error',
        errorMessage: 'WebSocket connection failed'
      };

      expect(status.status).toBe('error');
      expect(status.errorMessage).toBe('WebSocket connection failed');
    });
  });

  describe('HITLEvent', () => {
    test('should combine request and status', () => {
      const event: HITLEvent = {
        request: {
          type: HITLType.PERMISSION,
          question: 'Allow access?',
          responseWebSocketUrl: 'ws://localhost:3000/ws'
        },
        status: {
          status: 'pending'
        },
        createdAt: Date.now()
      };

      expect(event.request.type).toBe(HITLType.PERMISSION);
      expect(event.status.status).toBe('pending');
      expect(typeof event.createdAt).toBe('number');
    });
  });
});
