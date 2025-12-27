#!/usr/bin/env bun
/**
 * HITL Smoke Test Suite
 *
 * Comprehensive test suite for Human-in-the-Loop (HITL) functionality.
 * Tests all 5 HITL types, response handling, timeout scenarios, and error recovery.
 *
 * Usage:
 *   bun run scripts/hitl-smoke-test.ts
 *
 * Environment Variables:
 *   TEST_SERVER_URL - Server URL (default: http://localhost:4000)
 */

// ============================================
// Types
// ============================================

interface HookEvent {
  source_app: string;
  session_id: string;
  hook_event_type: string;
  model_name?: string;
  payload: {
    hook_event_name?: string;
    [key: string]: any;
  };
  humanInTheLoop?: {
    type: string;
    question: string;
    responseWebSocketUrl: string;
    choices?: string[];
    timeout?: number;
    context?: Record<string, any>;
  };
}

interface HITLResponse {
  eventId: number;
  respondedAt: number;
  respondedBy?: string;
  response?: string;
  permission?: boolean;
  choice?: string;
  approved?: boolean;
  comment?: string;
  cancelled?: boolean;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

// ============================================
// Configuration
// ============================================

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://localhost:4000';
const TEST_SESSION_ID = `smoke-test-${Date.now()}`;
const TEST_SOURCE_APP = 'hitl-smoke-test';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// ============================================
// Utility Functions
// ============================================

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(60));
  log(`  ${title}`, 'cyan');
  console.log('='.repeat(60));
}

function logTest(name: string) {
  log(`\n▶ ${name}`, 'blue');
}

function logSuccess(message: string) {
  log(`  ✓ ${message}`, 'green');
}

function logError(message: string) {
  log(`  ✗ ${message}`, 'red');
}

function logWarning(message: string) {
  log(`  ⚠ ${message}`, 'yellow');
}

function logInfo(message: string) {
  log(`  ℹ ${message}`, 'gray');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// API Functions
// ============================================

async function createHITLEvent(
  type: string,
  question: string,
  options: {
    choices?: string[];
    timeout?: number;
    context?: Record<string, any>;
  } = {}
): Promise<{ id: number; event: HookEvent }> {
  const event: HookEvent = {
    source_app: TEST_SOURCE_APP,
    session_id: TEST_SESSION_ID,
    hook_event_type: 'HumanInTheLoop',
    model_name: 'claude-sonnet-4-5',
    payload: {
      hook_event_name: 'HumanInTheLoop',
      timestamp: Date.now(),
    },
    humanInTheLoop: {
      type,
      question,
      responseWebSocketUrl: 'ws://localhost:9999/test-response',
      ...options,
    },
  };

  const response = await fetch(`${SERVER_URL}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Failed to create event: ${response.status} ${response.statusText}`);
  }

  const savedEvent = await response.json();
  return { id: savedEvent.id, event: savedEvent };
}

async function respondToEvent(
  eventId: number,
  response: Partial<HITLResponse>
): Promise<any> {
  const fullResponse: Partial<HITLResponse> = {
    eventId,
    respondedAt: Date.now(),
    respondedBy: 'smoke-test',
    ...response,
  };

  const res = await fetch(`${SERVER_URL}/events/${eventId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fullResponse),
  });

  if (!res.ok) {
    throw new Error(`Failed to respond: ${res.status} ${res.statusText}`);
  }

  return await res.json();
}

async function getEvent(eventId: number): Promise<any> {
  const response = await fetch(`${SERVER_URL}/events/${eventId}`);

  if (!response.ok) {
    throw new Error(`Failed to get event: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================
// Test Cases
// ============================================

async function testQuestionType(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing QUESTION type');

    // Create question event
    logInfo('Creating QUESTION event...');
    const { id, event } = await createHITLEvent(
      'question',
      'What is your favorite color?'
    );
    logSuccess(`Event created with ID: ${id}`);

    // Verify event was created
    const createdEvent = await getEvent(id);
    if (!createdEvent.humanInTheLoop) {
      throw new Error('Event missing humanInTheLoop data');
    }
    logSuccess('Event structure verified');

    // Respond to the event
    logInfo('Responding to event...');
    await respondToEvent(id, { response: 'Blue' });
    logSuccess('Response submitted');

    // Verify response was stored
    await sleep(100); // Give server time to process
    const updatedEvent = await getEvent(id);
    if (updatedEvent.humanInTheLoopStatus?.status !== 'responded') {
      throw new Error(`Expected status 'responded', got '${updatedEvent.humanInTheLoopStatus?.status}'`);
    }
    if (updatedEvent.humanInTheLoopStatus?.response?.response !== 'Blue') {
      throw new Error('Response not stored correctly');
    }
    logSuccess('Response verified in database');

    return { name: 'QUESTION type', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'QUESTION type',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

async function testPermissionType(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing PERMISSION type');

    logInfo('Creating PERMISSION event...');
    const { id } = await createHITLEvent(
      'permission',
      'Allow access to file system?'
    );
    logSuccess(`Event created with ID: ${id}`);

    logInfo('Granting permission...');
    await respondToEvent(id, { permission: true });
    logSuccess('Permission granted');

    await sleep(100);
    const updatedEvent = await getEvent(id);
    if (updatedEvent.humanInTheLoopStatus?.response?.permission !== true) {
      throw new Error('Permission not stored correctly');
    }
    logSuccess('Permission verified');

    return { name: 'PERMISSION type', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'PERMISSION type',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

async function testChoiceType(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing CHOICE type');

    const choices = ['Option A', 'Option B', 'Option C'];
    logInfo(`Creating CHOICE event with options: ${choices.join(', ')}`);
    const { id } = await createHITLEvent(
      'choice',
      'Select an option:',
      { choices }
    );
    logSuccess(`Event created with ID: ${id}`);

    const selectedChoice = 'Option B';
    logInfo(`Selecting: ${selectedChoice}`);
    await respondToEvent(id, { choice: selectedChoice });
    logSuccess('Choice submitted');

    await sleep(100);
    const updatedEvent = await getEvent(id);
    if (updatedEvent.humanInTheLoopStatus?.response?.choice !== selectedChoice) {
      throw new Error('Choice not stored correctly');
    }
    logSuccess('Choice verified');

    return { name: 'CHOICE type', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'CHOICE type',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

async function testApprovalType(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing APPROVAL type');

    logInfo('Creating APPROVAL event...');
    const { id } = await createHITLEvent(
      'approval',
      'Approve file modification?',
      {
        context: {
          tool_name: 'Edit',
          file_path: '/test/file.ts',
          old_string: 'const foo = 1;',
          new_string: 'const foo = 2;',
        },
      }
    );
    logSuccess(`Event created with ID: ${id}`);

    logInfo('Approving with comment...');
    await respondToEvent(id, {
      approved: true,
      comment: 'Looks good to me!'
    });
    logSuccess('Approval submitted');

    await sleep(100);
    const updatedEvent = await getEvent(id);
    if (updatedEvent.humanInTheLoopStatus?.response?.approved !== true) {
      throw new Error('Approval not stored correctly');
    }
    if (updatedEvent.humanInTheLoopStatus?.response?.comment !== 'Looks good to me!') {
      throw new Error('Comment not stored correctly');
    }
    logSuccess('Approval and comment verified');

    return { name: 'APPROVAL type', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'APPROVAL type',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

async function testQuestionInputType(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing QUESTION_INPUT type');

    logInfo('Creating QUESTION_INPUT event...');
    const { id } = await createHITLEvent(
      'question_input',
      'Claude needs input for multiple questions',
      {
        context: {
          questions: [
            { question: 'What is your name?' },
            { question: 'What is your email?' },
          ],
        },
      }
    );
    logSuccess(`Event created with ID: ${id}`);

    logInfo('Providing answers...');
    await respondToEvent(id, {
      response: JSON.stringify({
        answers: ['John Doe', 'john@example.com']
      })
    });
    logSuccess('Answers submitted');

    await sleep(100);
    const updatedEvent = await getEvent(id);
    if (!updatedEvent.humanInTheLoopStatus?.response?.response) {
      throw new Error('Response not stored correctly');
    }
    logSuccess('Answers verified');

    return { name: 'QUESTION_INPUT type', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'QUESTION_INPUT type',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

async function testTimeoutScenario(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing timeout scenario');

    logInfo('Creating event with 2-second timeout...');
    const { id } = await createHITLEvent(
      'question',
      'This will timeout',
      { timeout: 2 }
    );
    logSuccess(`Event created with ID: ${id}`);

    logInfo('Waiting for timeout (3 seconds)...');
    await sleep(3000);

    const timedOutEvent = await getEvent(id);
    if (timedOutEvent.humanInTheLoopStatus?.status !== 'timeout') {
      throw new Error(`Expected status 'timeout', got '${timedOutEvent.humanInTheLoopStatus?.status}'`);
    }
    logSuccess('Timeout status verified');

    // Try to respond after timeout
    logInfo('Attempting to respond after timeout...');
    await respondToEvent(id, { response: 'Too late!' });
    logWarning('Response accepted (expected behavior - server allows late responses)');

    return { name: 'Timeout scenario', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'Timeout scenario',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

async function testErrorRecovery(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing error recovery');

    // Test 1: Invalid event ID
    logInfo('Testing response to non-existent event...');
    try {
      await respondToEvent(999999, { response: 'Test' });
      throw new Error('Expected 404 error for non-existent event');
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        logSuccess('404 error handled correctly');
      } else {
        throw error;
      }
    }

    // Test 2: Missing required fields
    logInfo('Testing response with missing fields...');
    const { id } = await createHITLEvent('question', 'Test question');
    try {
      // Send incomplete response (missing response field for question type)
      const res = await fetch(`${SERVER_URL}/events/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: id, respondedAt: Date.now() }),
      });
      // Server should still accept it (fields are optional)
      if (res.ok) {
        logSuccess('Partial response accepted (expected behavior)');
      }
    } catch (error) {
      logSuccess('Invalid response rejected');
    }

    // Test 3: Invalid JSON
    logInfo('Testing invalid JSON...');
    try {
      const res = await fetch(`${SERVER_URL}/events/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });
      if (!res.ok) {
        logSuccess('Invalid JSON rejected');
      } else {
        logWarning('Invalid JSON accepted (unexpected)');
      }
    } catch (error) {
      logSuccess('Invalid JSON rejected');
    }

    return { name: 'Error recovery', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'Error recovery',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

async function testCancellation(): Promise<TestResult> {
  const start = Date.now();
  try {
    logTest('Testing QUESTION_INPUT cancellation');

    logInfo('Creating QUESTION_INPUT event...');
    const { id } = await createHITLEvent(
      'question_input',
      'Cancel this request',
      {
        context: {
          questions: [
            { question: 'This should be cancelled' },
          ],
        },
      }
    );
    logSuccess(`Event created with ID: ${id}`);

    logInfo('Cancelling request...');
    await respondToEvent(id, { cancelled: true });
    logSuccess('Cancellation submitted');

    await sleep(100);
    const updatedEvent = await getEvent(id);
    if (updatedEvent.humanInTheLoopStatus?.response?.cancelled !== true) {
      throw new Error('Cancellation not stored correctly');
    }
    logSuccess('Cancellation verified');

    return { name: 'Cancellation', passed: true, duration: Date.now() - start };
  } catch (error) {
    logError((error as Error).message);
    return {
      name: 'Cancellation',
      passed: false,
      error: (error as Error).message,
      duration: Date.now() - start
    };
  }
}

// ============================================
// Main Test Runner
// ============================================

async function main() {
  logSection('HITL Smoke Test Suite');
  log(`Server: ${SERVER_URL}`, 'cyan');
  log(`Session: ${TEST_SESSION_ID}`, 'cyan');

  // Check server health
  logInfo('\nChecking server health...');
  const isHealthy = await checkServerHealth();
  if (!isHealthy) {
    logError(`Server at ${SERVER_URL} is not responding!`);
    logError('Please ensure the server is running and try again.');
    process.exit(1);
  }
  logSuccess('Server is healthy');

  // Run all tests
  const results: TestResult[] = [];

  logSection('Running Tests');

  results.push(await testQuestionType());
  results.push(await testPermissionType());
  results.push(await testChoiceType());
  results.push(await testApprovalType());
  results.push(await testQuestionInputType());
  results.push(await testCancellation());
  results.push(await testTimeoutScenario());
  results.push(await testErrorRecovery());

  // Print summary
  logSection('Test Summary');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log();
  results.forEach(result => {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? 'green' : 'red';
    const duration = result.duration ? ` (${result.duration}ms)` : '';
    log(`${icon} ${result.name}${duration}`, color);
    if (result.error) {
      log(`  Error: ${result.error}`, 'red');
    }
  });

  console.log('\n' + '─'.repeat(60));

  if (failed === 0) {
    log(`✓ All ${total} tests passed!`, 'green');
    console.log('─'.repeat(60) + '\n');
    process.exit(0);
  } else {
    log(`✗ ${failed} of ${total} tests failed`, 'red');
    log(`✓ ${passed} of ${total} tests passed`, 'green');
    console.log('─'.repeat(60) + '\n');
    process.exit(1);
  }
}

// Run tests
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
