#!/usr/bin/env bun
/**
 * HITL Health Check Script
 *
 * Runs periodic health checks on the HITL observability server.
 * Designed to be run as a cron job every 5 minutes.
 *
 * Checks:
 * 1. Server is running (GET /health)
 * 2. Database connection (verify events can be fetched)
 * 3. HITL service metrics (pending count)
 * 4. Quick smoke test (create event, respond, verify)
 * 5. Stale pending requests (> 5 minutes old)
 *
 * On failure, sends Telegram notification using:
 * - TELEGRAM_BOT_TOKEN env var
 * - TELEGRAM_CHAT_ID env var
 *
 * Usage:
 *   bun scripts/hitl-health-check.ts [--json] [--no-telegram]
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - One or more checks failed
 */

import { exit } from 'process';

// =============================================================================
// Configuration
// =============================================================================

const SERVER_URL = process.env.HITL_SERVER_URL || 'http://localhost:4000';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Parse CLI flags
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const skipTelegram = args.includes('--no-telegram');

// =============================================================================
// Types
// =============================================================================

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  details?: unknown;
  duration?: number;
}

interface HealthCheckReport {
  timestamp: number;
  overallStatus: 'pass' | 'fail';
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

interface HookEvent {
  source_app: string;
  session_id: string;
  hook_event_type: string;
  payload: Record<string, unknown>;
  humanInTheLoop?: {
    prompt: string;
    timeout: number;
    responseWebSocketUrl: string;
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Console logger with color support
 */
class Logger {
  private jsonMode: boolean;

  constructor(jsonMode: boolean) {
    this.jsonMode = jsonMode;
  }

  log(message: string) {
    if (!this.jsonMode) {
      console.log(message);
    }
  }

  success(check: string) {
    if (!this.jsonMode) {
      console.log(`✅ ${check}`);
    }
  }

  fail(check: string) {
    if (!this.jsonMode) {
      console.log(`❌ ${check}`);
    }
  }

  skip(check: string) {
    if (!this.jsonMode) {
      console.log(`⏭️  ${check}`);
    }
  }

  header(text: string) {
    if (!this.jsonMode) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(text);
      console.log('='.repeat(60));
    }
  }
}

const logger = new Logger(jsonOutput);

/**
 * Send Telegram notification
 */
async function sendTelegramNotification(message: string): Promise<boolean> {
  if (skipTelegram || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return false;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML'
        })
      }
    );

    if (!response.ok) {
      console.error(`Telegram notification failed: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Failed to send Telegram notification:', error);
    return false;
  }
}

/**
 * Format report for Telegram
 */
function formatTelegramMessage(report: HealthCheckReport): string {
  const emoji = report.overallStatus === 'pass' ? '🟢' : '🔴';
  const status = report.overallStatus === 'pass' ? 'PASSED' : 'FAILED';

  let message = `${emoji} <b>HITL Health Check ${status}</b>\n\n`;

  // Add check results
  for (const check of report.checks) {
    const checkEmoji = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⏭️';
    message += `${checkEmoji} <b>${check.name}</b>\n`;
    message += `   ${check.message}\n`;

    if (check.status === 'fail' && check.details) {
      const detailStr = typeof check.details === 'string'
        ? check.details
        : JSON.stringify(check.details);
      message += `   <code>${detailStr.slice(0, 200)}</code>\n`;
    }
    message += '\n';
  }

  // Add summary
  message += `<b>Summary:</b> ${report.summary.passed}/${report.summary.total} checks passed`;

  if (report.summary.failed > 0) {
    message += `\n⚠️ <b>Action Required:</b> Investigate failed checks`;
  }

  message += `\n\n<i>Timestamp: ${new Date(report.timestamp).toISOString()}</i>`;

  return message;
}

// =============================================================================
// Health Checks
// =============================================================================

/**
 * Check 1: Server is running
 */
async function checkServerHealth(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return {
        name: 'Server Health',
        status: 'fail',
        message: `Server returned ${response.status}`,
        duration: Date.now() - start
      };
    }

    const data = await response.json();

    return {
      name: 'Server Health',
      status: 'pass',
      message: `Server running (uptime: ${Math.floor(data.uptime)}s)`,
      details: data,
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'Server Health',
      status: 'fail',
      message: 'Server unreachable',
      details: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

/**
 * Check 2: Database connection
 */
async function checkDatabaseConnection(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await fetch(`${SERVER_URL}/events/summaries?limit=1`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return {
        name: 'Database Connection',
        status: 'fail',
        message: `Database query failed (${response.status})`,
        duration: Date.now() - start
      };
    }

    const data = await response.json();

    return {
      name: 'Database Connection',
      status: 'pass',
      message: 'Database accessible',
      details: { eventCount: data.data?.length || 0 },
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'Database Connection',
      status: 'fail',
      message: 'Database query error',
      details: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

/**
 * Check 3: HITL metrics endpoint
 */
async function checkHITLMetrics(): Promise<CheckResult> {
  const start = Date.now();

  // Note: This endpoint doesn't exist in the current API
  // We'll check for stale pending requests instead
  try {
    const response = await fetch(`${SERVER_URL}/events/summaries?limit=100`, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      return {
        name: 'HITL Metrics',
        status: 'fail',
        message: `Failed to fetch events (${response.status})`,
        duration: Date.now() - start
      };
    }

    const data = await response.json();
    const events = data.data || [];

    // Count pending HITL requests
    const pendingCount = events.filter((e: any) =>
      e.hitl_request &&
      e.humanInTheLoopStatus?.status === 'pending'
    ).length;

    return {
      name: 'HITL Metrics',
      status: 'pass',
      message: `${pendingCount} pending HITL requests`,
      details: { pendingCount },
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'HITL Metrics',
      status: 'fail',
      message: 'Failed to query HITL metrics',
      details: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

/**
 * Check 4: Smoke test (create event, verify storage)
 */
async function checkSmokeTest(): Promise<CheckResult> {
  const start = Date.now();
  const testSessionId = `health-check-${Date.now()}`;

  try {
    // Create a test event (non-HITL to avoid side effects)
    const testEvent: HookEvent = {
      source_app: 'health-check',
      session_id: testSessionId,
      hook_event_type: 'health_check',
      payload: {
        timestamp: Date.now(),
        check: 'smoke-test'
      }
    };

    const createResponse = await fetch(`${SERVER_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testEvent),
      signal: AbortSignal.timeout(5000)
    });

    if (!createResponse.ok) {
      return {
        name: 'Smoke Test',
        status: 'fail',
        message: `Failed to create test event (${createResponse.status})`,
        duration: Date.now() - start
      };
    }

    const createdEvent = await createResponse.json();

    // Verify event was stored
    if (!createdEvent.id) {
      return {
        name: 'Smoke Test',
        status: 'fail',
        message: 'Created event has no ID',
        duration: Date.now() - start
      };
    }

    // Try to fetch the event back
    const fetchResponse = await fetch(
      `${SERVER_URL}/events/${createdEvent.id}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (!fetchResponse.ok) {
      return {
        name: 'Smoke Test',
        status: 'fail',
        message: 'Failed to retrieve created event',
        duration: Date.now() - start
      };
    }

    return {
      name: 'Smoke Test',
      status: 'pass',
      message: 'Event creation and retrieval working',
      details: { eventId: createdEvent.id },
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'Smoke Test',
      status: 'fail',
      message: 'Smoke test failed',
      details: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

/**
 * Check 5: Stale pending requests
 */
async function checkStalePendingRequests(): Promise<CheckResult> {
  const start = Date.now();

  try {
    const response = await fetch(`${SERVER_URL}/events/summaries?limit=500`, {
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return {
        name: 'Stale Requests',
        status: 'fail',
        message: `Failed to fetch events (${response.status})`,
        duration: Date.now() - start
      };
    }

    const data = await response.json();
    const events = data.data || [];
    const now = Date.now();

    // Find pending HITL requests older than threshold
    const stalePending = events.filter((e: any) => {
      if (!e.hitl_request || e.humanInTheLoopStatus?.status !== 'pending') {
        return false;
      }

      const age = now - e.timestamp;
      return age > STALE_THRESHOLD_MS;
    });

    if (stalePending.length > 0) {
      return {
        name: 'Stale Requests',
        status: 'fail',
        message: `Found ${stalePending.length} stale pending requests (> 5 min)`,
        details: {
          count: stalePending.length,
          oldestAge: Math.max(...stalePending.map((e: any) => now - e.timestamp))
        },
        duration: Date.now() - start
      };
    }

    return {
      name: 'Stale Requests',
      status: 'pass',
      message: 'No stale pending requests found',
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'Stale Requests',
      status: 'fail',
      message: 'Failed to check for stale requests',
      details: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

/**
 * Check 6: WebSocket endpoint connectivity
 */
async function checkWebSocketEndpoint(): Promise<CheckResult> {
  const start = Date.now();

  try {
    // Try to establish WebSocket connection
    const wsUrl = SERVER_URL.replace('http://', 'ws://').replace('https://', 'wss://');
    const ws = new WebSocket(`${wsUrl}/stream`);

    // Wait for connection or timeout
    const connected = await Promise.race([
      new Promise<boolean>((resolve) => {
        ws.onopen = () => {
          ws.close();
          resolve(true);
        };
        ws.onerror = () => resolve(false);
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))
    ]);

    if (!connected) {
      return {
        name: 'WebSocket Endpoint',
        status: 'fail',
        message: 'WebSocket connection failed',
        duration: Date.now() - start
      };
    }

    return {
      name: 'WebSocket Endpoint',
      status: 'pass',
      message: 'WebSocket endpoint accessible',
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'WebSocket Endpoint',
      status: 'fail',
      message: 'WebSocket connection error',
      details: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  logger.header('HITL Health Check');
  logger.log(`Server: ${SERVER_URL}`);
  logger.log(`Time: ${new Date().toISOString()}\n`);

  // Run all checks
  const checks: CheckResult[] = [];

  logger.log('Running checks...\n');

  checks.push(await checkServerHealth());
  checks.push(await checkDatabaseConnection());
  checks.push(await checkHITLMetrics());
  checks.push(await checkSmokeTest());
  checks.push(await checkStalePendingRequests());
  checks.push(await checkWebSocketEndpoint());

  // Calculate summary
  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'pass').length,
    failed: checks.filter(c => c.status === 'fail').length,
    skipped: checks.filter(c => c.status === 'skip').length
  };

  const overallStatus: 'pass' | 'fail' = summary.failed > 0 ? 'fail' : 'pass';

  const report: HealthCheckReport = {
    timestamp: Date.now(),
    overallStatus,
    checks,
    summary
  };

  // Output results
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    // Console output with colors
    logger.log('');
    for (const check of checks) {
      if (check.status === 'pass') {
        logger.success(`${check.name}: ${check.message}`);
      } else if (check.status === 'fail') {
        logger.fail(`${check.name}: ${check.message}`);
      } else {
        logger.skip(`${check.name}: ${check.message}`);
      }

      if (check.duration) {
        logger.log(`   (${check.duration}ms)`);
      }
    }

    logger.log('');
    logger.header('Summary');
    logger.log(`Total: ${summary.total}`);
    logger.log(`Passed: ${summary.passed}`);
    logger.log(`Failed: ${summary.failed}`);
    logger.log(`Skipped: ${summary.skipped}`);
    logger.log('');

    if (overallStatus === 'pass') {
      logger.log('🟢 Overall Status: PASS\n');
    } else {
      logger.log('🔴 Overall Status: FAIL\n');
    }
  }

  // Send Telegram notification on failure
  if (overallStatus === 'fail' && !skipTelegram) {
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      logger.log('Sending Telegram notification...');
      const message = formatTelegramMessage(report);
      const sent = await sendTelegramNotification(message);

      if (sent) {
        logger.log('✅ Telegram notification sent\n');
      } else {
        logger.log('❌ Failed to send Telegram notification\n');
      }
    } else {
      logger.log('⚠️  Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)\n');
    }
  }

  // Exit with appropriate code
  exit(overallStatus === 'pass' ? 0 : 1);
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  exit(1);
});
