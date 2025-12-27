/**
 * HITL Service
 *
 * Центральная точка управления HITL запросами.
 * Обеспечивает обработку событий, управление таймаутами
 * и отправку ответов агентам.
 */

import type { HookEvent } from '../types';
import type { HITLRequest, HITLResponse, HITLStatus, HITLStatusType } from './types';
import { getHITLConfig } from './types';
import { HITLAdapterChain, hitlAdapterChain } from './adapters';
import { validateWebSocketUrl, sendWebSocketMessage } from './validation';

/**
 * Callback для обработки таймаута
 */
type TimeoutCallback = (eventId: number) => void | Promise<void>;

/**
 * Callback для обновления статуса
 */
type StatusUpdateCallback = (eventId: number, status: HITLStatus) => Promise<void>;

/**
 * Timeout manager для HITL запросов
 */
export class HITLTimeoutManager {
  private timers = new Map<number, NodeJS.Timeout>();
  private debugMode: boolean;

  constructor() {
    this.debugMode = getHITLConfig().enableDebugLogs;
  }

  /**
   * Установить таймер для события
   */
  set(eventId: number, timeoutSeconds: number, onTimeout: TimeoutCallback): void {
    // Очистить существующий таймер
    this.clear(eventId);

    if (timeoutSeconds <= 0) {
      if (this.debugMode) {
        console.log(`[HITLTimeoutManager] No timeout set for event ${eventId} (timeout=${timeoutSeconds})`);
      }
      return;
    }

    // Создать новый таймер
    const timer = setTimeout(async () => {
      if (this.debugMode) {
        console.warn(`[HITLTimeoutManager] Timeout for event ${eventId} after ${timeoutSeconds}s`);
      }
      this.timers.delete(eventId);

      try {
        await onTimeout(eventId);
      } catch (error) {
        console.error(`[HITLTimeoutManager] Error in timeout callback for event ${eventId}:`, error);
      }
    }, timeoutSeconds * 1000);

    this.timers.set(eventId, timer);

    if (this.debugMode) {
      console.log(`[HITLTimeoutManager] Timer set for event ${eventId}: ${timeoutSeconds}s`);
    }
  }

  /**
   * Очистить таймер для события
   */
  clear(eventId: number): boolean {
    const timer = this.timers.get(eventId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(eventId);

      if (this.debugMode) {
        console.log(`[HITLTimeoutManager] Timer cleared for event ${eventId}`);
      }
      return true;
    }
    return false;
  }

  /**
   * Проверить, есть ли активный таймер
   */
  has(eventId: number): boolean {
    return this.timers.has(eventId);
  }

  /**
   * Получить количество активных таймеров
   */
  get size(): number {
    return this.timers.size;
  }

  /**
   * Очистить все таймеры
   */
  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    const count = this.timers.size;
    this.timers.clear();

    if (this.debugMode) {
      console.log(`[HITLTimeoutManager] Cleared ${count} timers`);
    }
  }
}

/**
 * Метрики HITL сервиса
 */
export interface HITLMetrics {
  totalRequests: number;
  totalResponses: number;
  totalTimeouts: number;
  totalErrors: number;
  avgResponseTimeMs: number;
  pendingRequests: number;
  // Delivery metrics
  deliveredCount: number;
  failedDeliveryCount: number;
  pendingPollCount: number;
}

/**
 * HITL Service - центральная точка управления HITL запросами
 */
export class HITLService {
  private adapterChain: HITLAdapterChain;
  private timeoutManager: HITLTimeoutManager;
  private pendingRequests = new Map<number, { request: HITLRequest; createdAt: number }>();
  private debugMode: boolean;

  // Metrics
  private metrics: HITLMetrics = {
    totalRequests: 0,
    totalResponses: 0,
    totalTimeouts: 0,
    totalErrors: 0,
    avgResponseTimeMs: 0,
    pendingRequests: 0,
    deliveredCount: 0,
    failedDeliveryCount: 0,
    pendingPollCount: 0
  };
  private responseTimes: number[] = [];

  // Callbacks
  private statusUpdateCallback?: StatusUpdateCallback;

  constructor(adapterChain?: HITLAdapterChain) {
    this.adapterChain = adapterChain || hitlAdapterChain;
    this.timeoutManager = new HITLTimeoutManager();
    this.debugMode = getHITLConfig().enableDebugLogs;
  }

  /**
   * Установить callback для обновления статуса в БД
   */
  setStatusUpdateCallback(callback: StatusUpdateCallback): void {
    this.statusUpdateCallback = callback;
  }

  /**
   * Обработка входящего события и преобразование в HITL
   */
  async processEvent(event: HookEvent): Promise<HITLRequest | null> {
    // Попытка адаптации события
    const hitlRequest = this.adapterChain.tryAdapt(event);

    if (!hitlRequest) {
      return null; // Не HITL событие
    }

    const eventId = event.id;
    if (!eventId) {
      console.error('[HITLService] Event has no ID, cannot process HITL');
      return null;
    }

    // Валидация WebSocket URL
    if (!validateWebSocketUrl(hitlRequest.responseWebSocketUrl)) {
      console.error(`[HITLService] Invalid WebSocket URL for event ${eventId}`);
      this.metrics.totalErrors++;
      return null;
    }

    // Сохранить pending request
    this.pendingRequests.set(eventId, {
      request: hitlRequest,
      createdAt: Date.now()
    });

    // Обновить метрики
    this.metrics.totalRequests++;
    this.metrics.pendingRequests = this.pendingRequests.size;

    // Установка таймера
    const timeout = hitlRequest.timeout || getHITLConfig().defaultTimeout;
    this.timeoutManager.set(eventId, timeout, async (id) => {
      await this.handleTimeout(id);
    });

    if (this.debugMode) {
      console.log(`[HITLService] Processed HITL event ${eventId}, type: ${hitlRequest.type}`);
    }

    return hitlRequest;
  }

  /**
   * Обработка ответа пользователя
   */
  async handleResponse(eventId: number, response: HITLResponse): Promise<boolean> {
    // CRITICAL: Clear timeout FIRST to prevent race with handleTimeout
    this.timeoutManager.clear(eventId);

    // Atomically get and delete the pending request
    const pending = this.pendingRequests.get(eventId);
    if (!pending) {
      // Request already handled by timeout or doesn't exist
      if (this.debugMode) {
        console.warn(`[HITLService] No pending request for event ${eventId}, may have timed out`);
      }
      return false;
    }

    // Delete immediately after get to make it atomic
    this.pendingRequests.delete(eventId);

    // Calculate response time
    const responseTime = Date.now() - pending.createdAt;
    this.recordResponseTime(responseTime);

    // Обновить метрики
    this.metrics.totalResponses++;
    this.metrics.pendingRequests = this.pendingRequests.size;

    // Обновить статус через callback
    const status: HITLStatus = {
      status: 'responded',
      respondedAt: response.respondedAt,
      response
    };

    if (this.statusUpdateCallback) {
      try {
        await this.statusUpdateCallback(eventId, status);
      } catch (error) {
        console.error(`[HITLService] Failed to update status for event ${eventId}:`, error);
        this.metrics.totalErrors++;
        return false;
      }
    }

    if (this.debugMode) {
      console.log(`[HITLService] Response handled for event ${eventId}`);
    }

    return true;
  }

  /**
   * Отправить ответ агенту через WebSocket
   */
  async sendResponseToAgent(wsUrl: string, response: HITLResponse): Promise<boolean> {
    const config = getHITLConfig();

    for (let attempt = 1; attempt <= config.wsRetryAttempts; attempt++) {
      try {
        await sendWebSocketMessage(wsUrl, response);

        if (this.debugMode) {
          console.log(`[HITLService] Response sent to agent via ${wsUrl}`);
        }
        return true;
      } catch (error) {
        console.warn(`[HITLService] WebSocket send attempt ${attempt}/${config.wsRetryAttempts} failed:`, error);

        if (attempt < config.wsRetryAttempts) {
          await this.sleep(config.wsRetryDelay * attempt); // Exponential backoff
        }
      }
    }

    console.error(`[HITLService] Failed to send response to agent after ${config.wsRetryAttempts} attempts`);
    this.metrics.totalErrors++;
    return false;
  }

  /**
   * Обработка таймаута
   */
  private async handleTimeout(eventId: number): Promise<void> {
    // CRITICAL: Check if request still exists (might have been handled by handleResponse)
    const pending = this.pendingRequests.get(eventId);
    if (!pending) {
      // Request already handled by response, ignore timeout
      if (this.debugMode) {
        console.log(`[HITLService] Timeout ignored for event ${eventId}, already handled by response`);
      }
      return;
    }

    // Delete from pending
    this.pendingRequests.delete(eventId);

    // Обновить метрики
    this.metrics.totalTimeouts++;
    this.metrics.pendingRequests = this.pendingRequests.size;

    // Обновить статус через callback
    const status: HITLStatus = {
      status: 'timeout',
      timeoutAt: Date.now()
    };

    if (this.statusUpdateCallback) {
      try {
        await this.statusUpdateCallback(eventId, status);
      } catch (error) {
        console.error(`[HITLService] Failed to update timeout status for event ${eventId}:`, error);
      }
    }

    if (this.debugMode) {
      console.log(`[HITLService] Timeout handled for event ${eventId}`);
    }
  }

  /**
   * Пометить событие как ошибку
   */
  async markAsError(eventId: number, errorMessage: string): Promise<void> {
    this.timeoutManager.clear(eventId);
    this.pendingRequests.delete(eventId);

    this.metrics.totalErrors++;
    this.metrics.pendingRequests = this.pendingRequests.size;

    const status: HITLStatus = {
      status: 'error',
      errorMessage
    };

    if (this.statusUpdateCallback) {
      try {
        await this.statusUpdateCallback(eventId, status);
      } catch (error) {
        console.error(`[HITLService] Failed to update error status for event ${eventId}:`, error);
      }
    }
  }

  /**
   * Проверить, является ли событие HITL
   */
  isHITLEvent(event: HookEvent): boolean {
    return this.adapterChain.isHITLEvent(event);
  }

  /**
   * Получить метрики сервиса
   */
  getMetrics(): HITLMetrics {
    return { ...this.metrics };
  }

  /**
   * Сбросить метрики
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      totalResponses: 0,
      totalTimeouts: 0,
      totalErrors: 0,
      avgResponseTimeMs: 0,
      pendingRequests: this.pendingRequests.size,
      deliveredCount: 0,
      failedDeliveryCount: 0,
      pendingPollCount: 0
    };
    this.responseTimes = [];
  }

  /**
   * Record delivery status for metrics
   */
  recordDeliveryStatus(status: 'delivered' | 'failed' | 'pending_poll'): void {
    switch (status) {
      case 'delivered':
        this.metrics.deliveredCount++;
        break;
      case 'failed':
        this.metrics.failedDeliveryCount++;
        break;
      case 'pending_poll':
        this.metrics.pendingPollCount++;
        break;
    }
  }

  /**
   * Cleanup при shutdown
   */
  shutdown(): void {
    this.timeoutManager.clearAll();
    this.pendingRequests.clear();

    if (this.debugMode) {
      console.log('[HITLService] Shutdown complete');
    }
  }

  /**
   * Записать время ответа для метрик
   */
  private recordResponseTime(ms: number): void {
    this.responseTimes.push(ms);

    // Ограничить размер массива
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }

    // Обновить среднее
    this.metrics.avgResponseTimeMs =
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  /**
   * Helper для ожидания
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const hitlService = new HITLService();
