/**
 * HITL (Human-in-the-Loop) Type System
 *
 * Унифицированная система типов для обработки HITL событий.
 * Все входящие события преобразуются в канонический формат.
 */

/**
 * Канонический enum для всех типов HITL взаимодействий
 */
export enum HITLType {
  // Простые вопросы от агента (текстовый ответ)
  QUESTION = 'question',

  // Запрос разрешения (да/нет)
  PERMISSION = 'permission',

  // Выбор из списка опций
  CHOICE = 'choice',

  // Approval с контекстом (file edit, command, etc.)
  APPROVAL = 'approval',

  // Перенаправленный вопрос от Claude
  QUESTION_INPUT = 'question_input'
}

/**
 * Маппинг legacy типов на канонические
 */
export const HITL_TYPE_MAP: Record<string, HITLType> = {
  // Legacy notification types
  'permission_prompt': HITLType.PERMISSION,
  'idle_prompt': HITLType.QUESTION,

  // Direct HITL types
  'question': HITLType.QUESTION,
  'permission': HITLType.PERMISSION,
  'choice': HITLType.CHOICE,
  'approval': HITLType.APPROVAL,
  'question_input': HITLType.QUESTION_INPUT
};

/**
 * Нормализация типа HITL
 */
export function normalizeHITLType(type: string | undefined): HITLType {
  if (!type) {
    return HITLType.QUESTION;
  }

  const normalized = HITL_TYPE_MAP[type.toLowerCase()];
  if (!normalized) {
    console.warn(`[HITL] Unknown type: ${type}, defaulting to QUESTION`);
    return HITLType.QUESTION;
  }
  return normalized;
}

/**
 * Контекст для HITL запроса
 */
export interface HITLContext {
  // Legacy compatibility
  permission_type?: string;

  // Tool-related context
  tool_name?: string;
  command?: string;
  file_path?: string;

  // Edit tool context
  old_string?: string;
  new_string?: string;

  // Write tool context
  content?: string;

  // Question input context
  questions?: Array<{
    question?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;

  // Allow additional fields
  [key: string]: unknown;
}

/**
 * Стандартизированный HITL Request
 *
 * Каноническое представление HITL запроса.
 * Все входящие события преобразуются в этот формат.
 */
export interface HITLRequest {
  // Тип взаимодействия (канонический enum)
  type: HITLType;

  // Текст вопроса/запроса
  question: string;

  // WebSocket URL для ответа агенту
  responseWebSocketUrl: string;

  // Опциональные параметры
  choices?: string[];           // Для type=CHOICE
  timeout?: number;             // Таймаут в секундах (default: 300)
  requiresResponse?: boolean;   // Обязателен ли ответ (default: true)

  // Контекст для approval/question_input
  context?: HITLContext;
}

/**
 * Стандартизированный HITL Response
 *
 * Упрощенный формат ответа (без дублирования event)
 */
export interface HITLResponse {
  // ID события (вместо полного hookEvent)
  eventId: number;

  // Idempotency key for deduplication (UUID)
  idempotencyKey: string;

  // Временная метка ответа
  respondedAt: number;

  // Опциональный user ID
  respondedBy?: string;

  // Ответы (зависят от type)
  response?: string;      // Для QUESTION, QUESTION_INPUT
  permission?: boolean;   // Для PERMISSION
  choice?: string;        // Для CHOICE
  approved?: boolean;     // Для APPROVAL
  comment?: string;       // Опциональный комментарий для APPROVAL
  cancelled?: boolean;    // Для QUESTION_INPUT отмены
}

/**
 * Статусы HITL запроса
 */
export type HITLStatusType = 'pending' | 'responded' | 'timeout' | 'error';

/**
 * HITL Status tracking
 */
export interface HITLStatus {
  status: HITLStatusType;
  respondedAt?: number;
  response?: HITLResponse;
  errorMessage?: string;  // Для status='error'
  timeoutAt?: number;     // Для status='timeout'
}

/**
 * Полное HITL событие (Request + Status)
 */
export interface HITLEvent {
  request: HITLRequest;
  status: HITLStatus;
  createdAt: number;
}

/**
 * Конфигурация HITL
 */
export interface HITLConfig {
  // Default timeout (seconds)
  defaultTimeout: number;

  // WebSocket whitelist
  wsWhitelist: string[];

  // Retry settings для WebSocket отправки
  wsRetryAttempts: number;
  wsRetryDelay: number; // ms

  // Логирование
  enableDebugLogs: boolean;
}

/**
 * Default HITL config
 */
export const DEFAULT_HITL_CONFIG: HITLConfig = {
  defaultTimeout: 300,  // 5 minutes
  wsWhitelist: ['localhost', '127.0.0.1', '[::1]', '::1'],
  wsRetryAttempts: 3,
  wsRetryDelay: 1000,
  enableDebugLogs: false
};

/**
 * Helper for safe parseInt with fallback
 */
function parseIntSafe(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Получить конфигурацию из env
 */
export function getHITLConfig(): HITLConfig {
  return {
    defaultTimeout: parseIntSafe(process.env.HITL_DEFAULT_TIMEOUT, 300),
    wsWhitelist: process.env.HITL_WS_WHITELIST?.split(',') || DEFAULT_HITL_CONFIG.wsWhitelist,
    wsRetryAttempts: parseIntSafe(process.env.HITL_WS_RETRY_ATTEMPTS, 3),
    wsRetryDelay: parseIntSafe(process.env.HITL_WS_RETRY_DELAY, 1000),
    enableDebugLogs: process.env.HITL_DEBUG === 'true'
  };
}
