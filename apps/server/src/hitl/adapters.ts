/**
 * HITL Adapters
 *
 * Chain of Responsibility pattern для преобразования
 * различных типов событий в унифицированный HITLRequest.
 */

import type { HookEvent } from '../types';
import type { HITLRequest, HITLContext } from './types';
import { HITLType, normalizeHITLType, getHITLConfig } from './types';

/**
 * Базовый интерфейс адаптера
 */
export interface HITLAdapter {
  /**
   * Проверяет, может ли адаптер обработать данное событие
   */
  canHandle(event: HookEvent): boolean;

  /**
   * Преобразует HookEvent в HITLRequest
   */
  adapt(event: HookEvent): HITLRequest | null;

  /**
   * Название адаптера для логирования
   */
  readonly name: string;
}

/**
 * Адаптер для событий с прямым HumanInTheLoop полем
 */
export class DirectHITLAdapter implements HITLAdapter {
  readonly name = 'DirectHITLAdapter';

  canHandle(event: HookEvent): boolean {
    return !!event.humanInTheLoop;
  }

  adapt(event: HookEvent): HITLRequest | null {
    const hitl = event.humanInTheLoop;
    if (!hitl) return null;

    // Валидация обязательных полей
    if (!hitl.responseWebSocketUrl) {
      console.warn(`[${this.name}] Missing responseWebSocketUrl in event ${event.id}`);
      return null;
    }

    return {
      type: normalizeHITLType(hitl.type),
      question: hitl.question || 'No question provided',
      responseWebSocketUrl: hitl.responseWebSocketUrl,
      choices: hitl.choices,
      timeout: hitl.timeout || getHITLConfig().defaultTimeout,
      requiresResponse: hitl.requiresResponse ?? true,
      context: hitl.context as HITLContext
    };
  }
}

/**
 * Адаптер для PreToolUse событий с permission_mode='ask'
 */
export class PreToolUseHITLAdapter implements HITLAdapter {
  readonly name = 'PreToolUseHITLAdapter';

  canHandle(event: HookEvent): boolean {
    return event.hook_event_type === 'PreToolUse' &&
           event.payload?.permission_mode === 'ask';
  }

  adapt(event: HookEvent): HITLRequest | null {
    const payload = event.payload || {};
    const toolName = payload.tool_name || 'Unknown Tool';
    const toolInput = payload.tool_input || {};

    // WebSocket URL должен быть в payload
    const responseWebSocketUrl = payload.response_websocket_url ||
                                  payload.responseWebSocketUrl;
    if (!responseWebSocketUrl) {
      console.warn(`[${this.name}] Missing responseWebSocketUrl in PreToolUse event ${event.id}`);
      return null;
    }

    // Формирование вопроса на основе инструмента
    const question = this.buildQuestion(toolName, toolInput);

    return {
      type: HITLType.APPROVAL,
      question,
      responseWebSocketUrl,
      timeout: getHITLConfig().defaultTimeout,
      requiresResponse: true,
      context: {
        permission_type: 'tool_permission',
        tool_name: toolName,
        command: toolInput.command,
        file_path: toolInput.file_path,
        old_string: toolInput.old_string,
        new_string: toolInput.new_string,
        content: toolInput.content,
        description: toolInput.description
      }
    };
  }

  private buildQuestion(toolName: string, toolInput: Record<string, unknown>): string {
    switch (toolName) {
      case 'Bash':
        return toolInput.command
          ? `Execute command: \`${toolInput.command}\`?`
          : `Execute Bash command?`;

      case 'Edit':
        return toolInput.file_path
          ? `Edit file: ${toolInput.file_path}?`
          : `Edit file?`;

      case 'Write':
        return toolInput.file_path
          ? `Write to file: ${toolInput.file_path}?`
          : `Write to file?`;

      case 'Read':
        return toolInput.file_path
          ? `Read file: ${toolInput.file_path}?`
          : `Read file?`;

      case 'Task':
        return toolInput.description
          ? `Launch agent: ${toolInput.description}?`
          : `Launch agent?`;

      default:
        return `Allow ${toolName}?`;
    }
  }
}

/**
 * Адаптер для Notification событий с HITL типами
 */
export class NotificationHITLAdapter implements HITLAdapter {
  readonly name = 'NotificationHITLAdapter';

  private readonly hitlNotificationTypes = [
    'permission_prompt',
    'idle_prompt',
    'question',
    'approval'
  ];

  canHandle(event: HookEvent): boolean {
    if (event.hook_event_type !== 'Notification') return false;

    const notificationType = event.payload?.notification_type;
    return this.hitlNotificationTypes.includes(notificationType);
  }

  adapt(event: HookEvent): HITLRequest | null {
    const payload = event.payload || {};
    const notificationType = payload.notification_type;

    // WebSocket URL должен быть в payload
    const responseWebSocketUrl = payload.response_websocket_url ||
                                  payload.responseWebSocketUrl;
    if (!responseWebSocketUrl) {
      console.warn(`[${this.name}] Missing responseWebSocketUrl in Notification event ${event.id}`);
      return null;
    }

    // Извлечение вопроса
    const question = payload.message || payload.question || 'No message provided';

    return {
      type: normalizeHITLType(notificationType),
      question,
      responseWebSocketUrl,
      timeout: payload.timeout || getHITLConfig().defaultTimeout,
      requiresResponse: true,
      context: {
        permission_type: notificationType,
        ...payload.context
      }
    };
  }
}

/**
 * Адаптер для PostToolUse событий требующих подтверждения
 */
export class PostToolUseHITLAdapter implements HITLAdapter {
  readonly name = 'PostToolUseHITLAdapter';

  canHandle(event: HookEvent): boolean {
    return event.hook_event_type === 'PostToolUse' &&
           event.payload?.requires_confirmation === true;
  }

  adapt(event: HookEvent): HITLRequest | null {
    const payload = event.payload || {};

    const responseWebSocketUrl = payload.response_websocket_url ||
                                  payload.responseWebSocketUrl;
    if (!responseWebSocketUrl) {
      console.warn(`[${this.name}] Missing responseWebSocketUrl in PostToolUse event ${event.id}`);
      return null;
    }

    const toolName = payload.tool_name || 'Unknown Tool';
    const question = payload.confirmation_message ||
                     `Confirm ${toolName} result?`;

    return {
      type: HITLType.APPROVAL,
      question,
      responseWebSocketUrl,
      timeout: getHITLConfig().defaultTimeout,
      requiresResponse: true,
      context: {
        permission_type: 'tool_result_confirmation',
        tool_name: toolName,
        tool_result: payload.tool_result
      }
    };
  }
}

/**
 * Адаптер-менеджер (Chain of Responsibility pattern)
 */
export class HITLAdapterChain {
  private adapters: HITLAdapter[] = [];
  private debugMode: boolean;

  constructor() {
    this.debugMode = getHITLConfig().enableDebugLogs;

    // Регистрация адаптеров в порядке приоритета
    this.register(new DirectHITLAdapter());        // Самый высокий приоритет
    this.register(new PreToolUseHITLAdapter());
    this.register(new PostToolUseHITLAdapter());
    this.register(new NotificationHITLAdapter());  // Fallback
  }

  /**
   * Регистрация нового адаптера
   */
  register(adapter: HITLAdapter): void {
    this.adapters.push(adapter);
    if (this.debugMode) {
      console.log(`[HITLAdapterChain] Registered adapter: ${adapter.name}`);
    }
  }

  /**
   * Вставка адаптера в начало цепочки (высший приоритет)
   */
  registerFirst(adapter: HITLAdapter): void {
    this.adapters.unshift(adapter);
    if (this.debugMode) {
      console.log(`[HITLAdapterChain] Registered adapter (first): ${adapter.name}`);
    }
  }

  /**
   * Попытка преобразовать событие в HITL запрос
   */
  tryAdapt(event: HookEvent): HITLRequest | null {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(event)) {
        const result = adapter.adapt(event);
        if (result) {
          if (this.debugMode) {
            console.log(`[HITLAdapterChain] Adapted event ${event.id} using ${adapter.name}`);
          }
          return result;
        }
      }
    }

    if (this.debugMode) {
      console.log(`[HITLAdapterChain] No adapter found for event ${event.id}`);
    }

    return null;
  }

  /**
   * Проверка, является ли событие HITL
   */
  isHITLEvent(event: HookEvent): boolean {
    return this.adapters.some(adapter => adapter.canHandle(event));
  }

  /**
   * Получить список зарегистрированных адаптеров
   */
  getAdapters(): readonly HITLAdapter[] {
    return this.adapters;
  }
}

// Singleton instance
export const hitlAdapterChain = new HITLAdapterChain();
