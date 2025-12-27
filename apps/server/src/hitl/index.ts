/**
 * HITL Module
 *
 * Human-in-the-Loop functionality for observability server.
 * Provides unified handling of HITL events, timeout management,
 * and agent communication.
 */

// Types
export {
  HITLType,
  HITL_TYPE_MAP,
  normalizeHITLType,
  getHITLConfig,
  DEFAULT_HITL_CONFIG,
  type HITLContext,
  type HITLRequest,
  type HITLResponse,
  type HITLStatus,
  type HITLStatusType,
  type HITLEvent,
  type HITLConfig
} from './types';

// Adapters
export {
  type HITLAdapter,
  DirectHITLAdapter,
  PreToolUseHITLAdapter,
  PostToolUseHITLAdapter,
  NotificationHITLAdapter,
  HITLAdapterChain,
  hitlAdapterChain
} from './adapters';

// Service
export {
  HITLTimeoutManager,
  HITLService,
  hitlService,
  type HITLMetrics
} from './service';

// Validation
export {
  validateWebSocketUrl,
  sendWebSocketMessage,
  checkWebSocketEndpoint,
  normalizeWebSocketUrl,
  getWebSocketUrlInfo
} from './validation';
