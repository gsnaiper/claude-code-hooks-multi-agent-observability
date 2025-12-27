/**
 * HITL Validation
 *
 * Валидация WebSocket URL и отправка сообщений.
 * Включает защиту от SSRF атак.
 */

import { getHITLConfig } from './types';
import type { HITLResponse } from './types';

/**
 * Parse IP address to numeric value for CIDR comparison
 */
function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = (result << 8) | num;
  }
  return result >>> 0; // Convert to unsigned 32-bit
}

/**
 * Check if IP is within CIDR range
 */
function isInCIDR(ip: string, cidr: string): boolean {
  const [range, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);

  if (ipNum === null || rangeNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Check if hostname matches against a whitelist entry
 * Supports:
 * - '*' - allow all
 * - '*.example.com' - wildcard subdomain
 * - '192.168.0.0/16' - CIDR notation
 * - 'localhost' - exact match
 */
export function isHostnameAllowed(hostname: string, whitelist: string[]): boolean {
  for (const entry of whitelist) {
    // Allow all
    if (entry === '*') return true;

    // CIDR notation (for IPs)
    if (entry.includes('/')) {
      if (isInCIDR(hostname, entry)) return true;
      continue;
    }

    // Wildcard subdomain (e.g., *.example.com)
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // .example.com
      if (hostname.endsWith(suffix) || hostname === entry.slice(2)) return true;
      continue;
    }

    // Exact match
    if (hostname === entry) return true;
  }

  return false;
}

/**
 * Валидация WebSocket URL
 *
 * Проверяет URL на соответствие whitelist и безопасность.
 */
export function validateWebSocketUrl(wsUrl: string): boolean {
  const config = getHITLConfig();

  try {
    const url = new URL(wsUrl);

    // Только ws/wss протоколы
    if (!['ws:', 'wss:'].includes(url.protocol)) {
      if (config.enableDebugLogs) {
        console.warn(`[HITL Validation] Invalid protocol: ${url.protocol}`);
      }
      return false;
    }

    // Проверка hostname против whitelist (with wildcard/CIDR support)
    if (!isHostnameAllowed(url.hostname, config.wsWhitelist)) {
      if (config.enableDebugLogs) {
        console.warn(`[HITL Validation] Hostname not in whitelist: ${url.hostname}`);
        console.warn(`[HITL Validation] Allowed hosts: ${config.wsWhitelist.join(', ')}`);
      }
      return false;
    }

    // Валидация порта (только high ports для безопасности)
    const port = url.port ? parseInt(url.port) : (url.protocol === 'wss:' ? 443 : 80);

    // Разрешаем порты 80, 443 и высокие порты (>1023)
    if (port !== 80 && port !== 443 && (port < 1024 || port > 65535)) {
      if (config.enableDebugLogs) {
        console.warn(`[HITL Validation] Invalid port: ${port}`);
      }
      return false;
    }

    // Блокировка потенциально опасных путей
    const dangerousPaths = ['/admin', '/internal', '/private', '/.'];
    if (dangerousPaths.some(p => url.pathname.startsWith(p))) {
      if (config.enableDebugLogs) {
        console.warn(`[HITL Validation] Potentially dangerous path: ${url.pathname}`);
      }
      return false;
    }

    return true;
  } catch (e) {
    if (config.enableDebugLogs) {
      console.warn(`[HITL Validation] Invalid URL format: ${wsUrl}`, e);
    }
    return false;
  }
}

/**
 * Отправка сообщения через WebSocket
 *
 * Открывает соединение, отправляет сообщение и закрывает.
 */
export async function sendWebSocketMessage(
  wsUrl: string,
  message: HITLResponse
): Promise<void> {
  const config = getHITLConfig();

  return new Promise((resolve, reject) => {
    try {
      // Используем Bun WebSocket если доступен
      const WebSocketImpl = globalThis.WebSocket || require('ws');
      const ws = new WebSocketImpl(wsUrl);

      const timeoutId = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000); // 10 секунд таймаут

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify(message));
          clearTimeout(timeoutId);

          // Даем время на отправку
          setTimeout(() => {
            ws.close();
            resolve();
          }, 100);
        } catch (sendError) {
          clearTimeout(timeoutId);
          ws.close();
          reject(sendError);
        }
      };

      ws.onerror = (error: Event | Error) => {
        clearTimeout(timeoutId);
        const errorMessage = error instanceof Error ? error.message : 'WebSocket error';
        reject(new Error(errorMessage));
      };

      ws.onclose = (event: CloseEvent) => {
        clearTimeout(timeoutId);
        // Если закрылось до успешной отправки - это ошибка
        if (event.code !== 1000 && event.code !== 1005) {
          reject(new Error(`WebSocket closed with code ${event.code}`));
        }
      };

    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Проверка доступности WebSocket endpoint
 */
export async function checkWebSocketEndpoint(wsUrl: string): Promise<boolean> {
  const config = getHITLConfig();

  if (!validateWebSocketUrl(wsUrl)) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      const WebSocketImpl = globalThis.WebSocket || require('ws');
      const ws = new WebSocketImpl(wsUrl);

      const timeoutId = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 5000); // 5 секунд таймаут для проверки

      ws.onopen = () => {
        clearTimeout(timeoutId);
        ws.close();
        resolve(true);
      };

      ws.onerror = () => {
        clearTimeout(timeoutId);
        resolve(false);
      };

    } catch {
      resolve(false);
    }
  });
}

/**
 * Парсинг и нормализация WebSocket URL
 */
export function normalizeWebSocketUrl(url: string): string | null {
  try {
    const parsed = new URL(url);

    // Конвертация http -> ws, https -> wss
    if (parsed.protocol === 'http:') {
      parsed.protocol = 'ws:';
    } else if (parsed.protocol === 'https:') {
      parsed.protocol = 'wss:';
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Получить информацию о WebSocket URL
 */
export function getWebSocketUrlInfo(wsUrl: string): {
  valid: boolean;
  protocol: string | null;
  hostname: string | null;
  port: number | null;
  path: string | null;
  isSecure: boolean;
  isWhitelisted: boolean;
} {
  try {
    const url = new URL(wsUrl);
    const config = getHITLConfig();
    const port = url.port ? parseInt(url.port) : (url.protocol === 'wss:' ? 443 : 80);

    return {
      valid: validateWebSocketUrl(wsUrl),
      protocol: url.protocol,
      hostname: url.hostname,
      port,
      path: url.pathname,
      isSecure: url.protocol === 'wss:',
      isWhitelisted: isHostnameAllowed(url.hostname, config.wsWhitelist)
    };
  } catch {
    return {
      valid: false,
      protocol: null,
      hostname: null,
      port: null,
      path: null,
      isSecure: false,
      isWhitelisted: false
    };
  }
}
