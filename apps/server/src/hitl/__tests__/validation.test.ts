/**
 * HITL Validation Tests
 *
 * Comprehensive unit tests for WebSocket URL validation,
 * normalization, and URL info extraction.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  validateWebSocketUrl,
  normalizeWebSocketUrl,
  getWebSocketUrlInfo
} from '../validation';

// Environment setup/teardown helpers
const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset to default whitelist
  delete process.env.HITL_WS_WHITELIST;
  delete process.env.HITL_DEBUG;
});

afterEach(() => {
  // Restore original env
  process.env = { ...originalEnv };
});

describe('validateWebSocketUrl', () => {
  describe('valid URLs', () => {
    test('accepts ws://localhost:4000', () => {
      expect(validateWebSocketUrl('ws://localhost:4000')).toBe(true);
    });

    test('accepts wss://localhost:443', () => {
      expect(validateWebSocketUrl('wss://localhost:443')).toBe(true);
    });

    test('accepts ws://127.0.0.1:8080', () => {
      expect(validateWebSocketUrl('ws://127.0.0.1:8080')).toBe(true);
    });

    test('accepts wss://[::1]:3000', () => {
      // Default whitelist includes both [::1] and ::1
      // URL.hostname for [::1] returns '[::1]' which should match
      expect(validateWebSocketUrl('wss://[::1]:3000')).toBe(true);
    });

    test('accepts ws://localhost without explicit port (defaults to 80)', () => {
      expect(validateWebSocketUrl('ws://localhost')).toBe(true);
    });

    test('accepts wss://localhost without explicit port (defaults to 443)', () => {
      expect(validateWebSocketUrl('wss://localhost')).toBe(true);
    });

    test('accepts ws://localhost:80', () => {
      expect(validateWebSocketUrl('ws://localhost:80')).toBe(true);
    });

    test('accepts wss://localhost:443', () => {
      expect(validateWebSocketUrl('wss://localhost:443')).toBe(true);
    });

    test('accepts high ports (>1023)', () => {
      expect(validateWebSocketUrl('ws://localhost:1024')).toBe(true);
      expect(validateWebSocketUrl('ws://localhost:3000')).toBe(true);
      expect(validateWebSocketUrl('ws://localhost:8080')).toBe(true);
      expect(validateWebSocketUrl('ws://localhost:65535')).toBe(true);
    });

    test('accepts valid paths', () => {
      expect(validateWebSocketUrl('ws://localhost:4000/ws')).toBe(true);
      expect(validateWebSocketUrl('ws://localhost:4000/api/ws')).toBe(true);
      expect(validateWebSocketUrl('ws://localhost:4000/socket')).toBe(true);
    });

    test('accepts custom whitelisted hosts', () => {
      process.env.HITL_WS_WHITELIST = 'localhost,example.com,api.test.com';
      expect(validateWebSocketUrl('ws://example.com:4000')).toBe(true);
      expect(validateWebSocketUrl('wss://api.test.com:443')).toBe(true);
    });
  });

  describe('invalid protocol', () => {
    test('rejects http://', () => {
      expect(validateWebSocketUrl('http://localhost:4000')).toBe(false);
    });

    test('rejects https://', () => {
      expect(validateWebSocketUrl('https://localhost:443')).toBe(false);
    });

    test('rejects ftp://', () => {
      expect(validateWebSocketUrl('ftp://localhost:21')).toBe(false);
    });

    test('rejects file://', () => {
      expect(validateWebSocketUrl('file:///etc/passwd')).toBe(false);
    });

    test('rejects data://', () => {
      expect(validateWebSocketUrl('data:text/plain,test')).toBe(false);
    });

    test('rejects javascript:', () => {
      expect(validateWebSocketUrl('javascript:alert(1)')).toBe(false);
    });

    test('rejects protocol-relative URLs', () => {
      expect(validateWebSocketUrl('//localhost:4000')).toBe(false);
    });
  });

  describe('invalid host', () => {
    test('rejects non-whitelisted host', () => {
      expect(validateWebSocketUrl('ws://evil.com:4000')).toBe(false);
    });

    test('rejects external domain', () => {
      expect(validateWebSocketUrl('ws://example.com:4000')).toBe(false);
    });

    test('rejects IP not in whitelist', () => {
      expect(validateWebSocketUrl('ws://192.168.1.1:4000')).toBe(false);
    });

    test('rejects subdomain attempts', () => {
      expect(validateWebSocketUrl('ws://evil.localhost:4000')).toBe(false);
    });

    test('rejects localhost lookalikes', () => {
      expect(validateWebSocketUrl('ws://local-host:4000')).toBe(false);
      expect(validateWebSocketUrl('ws://localhostx:4000')).toBe(false);
    });
  });

  describe('dangerous paths', () => {
    test('rejects /admin path', () => {
      expect(validateWebSocketUrl('ws://localhost:4000/admin')).toBe(false);
    });

    test('rejects /admin subpaths', () => {
      expect(validateWebSocketUrl('ws://localhost:4000/admin/console')).toBe(false);
    });

    test('rejects /internal path', () => {
      expect(validateWebSocketUrl('ws://localhost:4000/internal')).toBe(false);
    });

    test('rejects /internal subpaths', () => {
      expect(validateWebSocketUrl('ws://localhost:4000/internal/api')).toBe(false);
    });

    test('rejects /private path', () => {
      expect(validateWebSocketUrl('ws://localhost:4000/private')).toBe(false);
    });

    test('rejects /private subpaths', () => {
      expect(validateWebSocketUrl('ws://localhost:4000/private/data')).toBe(false);
    });

    test('rejects /. path (hidden files)', () => {
      // Note: URL normalizes '..' to '/', so it won't be caught
      // But paths starting with '/.' that don't get normalized will be caught
      expect(validateWebSocketUrl('ws://localhost:4000/.git')).toBe(false);
      expect(validateWebSocketUrl('ws://localhost:4000/.env')).toBe(false);
      expect(validateWebSocketUrl('ws://localhost:4000/.config')).toBe(false);
    });
  });

  describe('invalid ports', () => {
    test('rejects well-known ports < 1024 (except 80, 443)', () => {
      expect(validateWebSocketUrl('ws://localhost:22')).toBe(false);  // SSH
      expect(validateWebSocketUrl('ws://localhost:23')).toBe(false);  // Telnet
      expect(validateWebSocketUrl('ws://localhost:25')).toBe(false);  // SMTP
      expect(validateWebSocketUrl('ws://localhost:21')).toBe(false);  // FTP
      expect(validateWebSocketUrl('ws://localhost:445')).toBe(false); // SMB - port 445 < 1024
      // Port 3389 is > 1023, so it's allowed
      expect(validateWebSocketUrl('ws://localhost:3389')).toBe(true); // RDP - allowed as high port
    });

    test('rejects port 0', () => {
      expect(validateWebSocketUrl('ws://localhost:0')).toBe(false);
    });

    test('rejects ports > 65535', () => {
      expect(validateWebSocketUrl('ws://localhost:65536')).toBe(false);
      expect(validateWebSocketUrl('ws://localhost:99999')).toBe(false);
    });

    test('rejects negative ports', () => {
      expect(validateWebSocketUrl('ws://localhost:-1')).toBe(false);
    });
  });

  describe('malformed URLs', () => {
    test('rejects invalid URL format', () => {
      expect(validateWebSocketUrl('not-a-url')).toBe(false);
    });

    test('rejects empty string', () => {
      expect(validateWebSocketUrl('')).toBe(false);
    });

    test('rejects missing protocol', () => {
      expect(validateWebSocketUrl('localhost:4000')).toBe(false);
    });

    test('rejects URLs with spaces', () => {
      expect(validateWebSocketUrl('ws://local host:4000')).toBe(false);
    });

    test('allows URLs with valid path characters', () => {
      // URL constructor accepts most characters in paths
      // Only truly malformed URLs are rejected
      expect(validateWebSocketUrl('ws://localhost:4000/<script>')).toBe(true);
      // This is actually a valid path from URL perspective
    });
  });

  describe('SSRF protection', () => {
    test('blocks internal metadata endpoints', () => {
      expect(validateWebSocketUrl('ws://169.254.169.254:80')).toBe(false);
    });

    test('blocks private network ranges', () => {
      expect(validateWebSocketUrl('ws://10.0.0.1:4000')).toBe(false);
      expect(validateWebSocketUrl('ws://172.16.0.1:4000')).toBe(false);
      expect(validateWebSocketUrl('ws://192.168.1.1:4000')).toBe(false);
    });

    test('blocks broadcast addresses', () => {
      expect(validateWebSocketUrl('ws://255.255.255.255:4000')).toBe(false);
    });
  });
});

describe('normalizeWebSocketUrl', () => {
  describe('protocol conversion', () => {
    test('converts http:// to ws://', () => {
      expect(normalizeWebSocketUrl('http://localhost:4000')).toBe('ws://localhost:4000/');
    });

    test('converts https:// to wss://', () => {
      // Default HTTPS port (443) is omitted in URL.toString()
      expect(normalizeWebSocketUrl('https://localhost:443')).toBe('wss://localhost/');
    });

    test('preserves ws:// protocol', () => {
      expect(normalizeWebSocketUrl('ws://localhost:4000')).toBe('ws://localhost:4000/');
    });

    test('preserves wss:// protocol', () => {
      // Default WSS port (443) is omitted in URL.toString()
      expect(normalizeWebSocketUrl('wss://localhost:443')).toBe('wss://localhost/');
    });
  });

  describe('URL preservation', () => {
    test('preserves hostname', () => {
      const normalized = normalizeWebSocketUrl('http://example.com:8080');
      expect(normalized).toContain('example.com');
    });

    test('preserves port', () => {
      const normalized = normalizeWebSocketUrl('http://localhost:8080');
      expect(normalized).toContain(':8080');
    });

    test('preserves path', () => {
      const normalized = normalizeWebSocketUrl('http://localhost:4000/api/ws');
      expect(normalized).toContain('/api/ws');
    });

    test('preserves query string', () => {
      const normalized = normalizeWebSocketUrl('http://localhost:4000/ws?token=abc123');
      expect(normalized).toContain('?token=abc123');
    });

    test('preserves hash fragment', () => {
      const normalized = normalizeWebSocketUrl('http://localhost:4000/ws#fragment');
      expect(normalized).toContain('#fragment');
    });
  });

  describe('edge cases', () => {
    test('returns null for invalid URLs', () => {
      expect(normalizeWebSocketUrl('not-a-url')).toBe(null);
    });

    test('returns null for empty string', () => {
      expect(normalizeWebSocketUrl('')).toBe(null);
    });

    test('handles URLs without port', () => {
      expect(normalizeWebSocketUrl('http://localhost')).toBe('ws://localhost/');
      expect(normalizeWebSocketUrl('https://localhost')).toBe('wss://localhost/');
    });

    test('handles URLs with IPv6 addresses', () => {
      const normalized = normalizeWebSocketUrl('http://[::1]:3000');
      expect(normalized).toContain('[::1]');
      expect(normalized).toContain('ws://');
    });
  });

  describe('complex URLs', () => {
    test('normalizes complete URL with all components', () => {
      const input = 'https://api.example.com:8080/ws/chat?room=123&token=xyz#main';
      const normalized = normalizeWebSocketUrl(input);
      expect(normalized).toContain('wss://');
      expect(normalized).toContain('api.example.com');
      expect(normalized).toContain(':8080');
      expect(normalized).toContain('/ws/chat');
      expect(normalized).toContain('?room=123&token=xyz');
      expect(normalized).toContain('#main');
    });

    test('handles URL with username:password (deprecated but valid)', () => {
      const normalized = normalizeWebSocketUrl('http://user:pass@localhost:4000');
      expect(normalized).not.toBe(null);
      expect(normalized).toContain('ws://');
    });
  });
});

describe('getWebSocketUrlInfo', () => {
  describe('valid URL info extraction', () => {
    test('extracts info from ws://localhost:4000', () => {
      const info = getWebSocketUrlInfo('ws://localhost:4000');
      expect(info.valid).toBe(true);
      expect(info.protocol).toBe('ws:');
      expect(info.hostname).toBe('localhost');
      expect(info.port).toBe(4000);
      expect(info.path).toBe('/');
      expect(info.isSecure).toBe(false);
      expect(info.isWhitelisted).toBe(true);
    });

    test('extracts info from wss://localhost:443', () => {
      const info = getWebSocketUrlInfo('wss://localhost:443');
      expect(info.valid).toBe(true);
      expect(info.protocol).toBe('wss:');
      expect(info.hostname).toBe('localhost');
      expect(info.port).toBe(443);
      expect(info.path).toBe('/');
      expect(info.isSecure).toBe(true);
      expect(info.isWhitelisted).toBe(true);
    });

    test('extracts info from ws://127.0.0.1:8080/api/ws', () => {
      const info = getWebSocketUrlInfo('ws://127.0.0.1:8080/api/ws');
      expect(info.valid).toBe(true);
      expect(info.protocol).toBe('ws:');
      expect(info.hostname).toBe('127.0.0.1');
      expect(info.port).toBe(8080);
      expect(info.path).toBe('/api/ws');
      expect(info.isSecure).toBe(false);
      expect(info.isWhitelisted).toBe(true);
    });

    test('defaults port to 80 for ws:// without explicit port', () => {
      const info = getWebSocketUrlInfo('ws://localhost');
      expect(info.port).toBe(80);
    });

    test('defaults port to 443 for wss:// without explicit port', () => {
      const info = getWebSocketUrlInfo('wss://localhost');
      expect(info.port).toBe(443);
    });
  });

  describe('isSecure flag', () => {
    test('isSecure is true for wss://', () => {
      const info = getWebSocketUrlInfo('wss://localhost:443');
      expect(info.isSecure).toBe(true);
    });

    test('isSecure is false for ws://', () => {
      const info = getWebSocketUrlInfo('ws://localhost:80');
      expect(info.isSecure).toBe(false);
    });
  });

  describe('isWhitelisted flag', () => {
    test('isWhitelisted is true for localhost', () => {
      const info = getWebSocketUrlInfo('ws://localhost:4000');
      expect(info.isWhitelisted).toBe(true);
    });

    test('isWhitelisted is true for 127.0.0.1', () => {
      const info = getWebSocketUrlInfo('ws://127.0.0.1:4000');
      expect(info.isWhitelisted).toBe(true);
    });

    test('isWhitelisted is true for [::1]', () => {
      const info = getWebSocketUrlInfo('ws://[::1]:4000');
      expect(info.isWhitelisted).toBe(true);
    });

    test('isWhitelisted is false for non-whitelisted host', () => {
      const info = getWebSocketUrlInfo('ws://example.com:4000');
      expect(info.isWhitelisted).toBe(false);
    });

    test('isWhitelisted respects custom whitelist', () => {
      process.env.HITL_WS_WHITELIST = 'localhost,example.com';
      const info = getWebSocketUrlInfo('ws://example.com:4000');
      expect(info.isWhitelisted).toBe(true);
    });
  });

  describe('valid flag combines all checks', () => {
    test('valid is true for compliant URL', () => {
      const info = getWebSocketUrlInfo('ws://localhost:4000/ws');
      expect(info.valid).toBe(true);
    });

    test('valid is false for wrong protocol', () => {
      const info = getWebSocketUrlInfo('http://localhost:4000');
      expect(info.valid).toBe(false);
    });

    test('valid is false for non-whitelisted host', () => {
      const info = getWebSocketUrlInfo('ws://evil.com:4000');
      expect(info.valid).toBe(false);
    });

    test('valid is false for dangerous path', () => {
      const info = getWebSocketUrlInfo('ws://localhost:4000/admin');
      expect(info.valid).toBe(false);
    });

    test('valid is false for invalid port', () => {
      const info = getWebSocketUrlInfo('ws://localhost:22');
      expect(info.valid).toBe(false);
    });
  });

  describe('invalid URL handling', () => {
    test('returns null values for malformed URL', () => {
      const info = getWebSocketUrlInfo('not-a-url');
      expect(info.valid).toBe(false);
      expect(info.protocol).toBe(null);
      expect(info.hostname).toBe(null);
      expect(info.port).toBe(null);
      expect(info.path).toBe(null);
      expect(info.isSecure).toBe(false);
      expect(info.isWhitelisted).toBe(false);
    });

    test('returns null values for empty string', () => {
      const info = getWebSocketUrlInfo('');
      expect(info.valid).toBe(false);
      expect(info.protocol).toBe(null);
      expect(info.hostname).toBe(null);
      expect(info.port).toBe(null);
      expect(info.path).toBe(null);
      expect(info.isSecure).toBe(false);
      expect(info.isWhitelisted).toBe(false);
    });
  });

  describe('IPv6 handling', () => {
    test('extracts info from IPv6 URL', () => {
      const info = getWebSocketUrlInfo('ws://[::1]:3000');
      expect(info.valid).toBe(true);
      // URL.hostname includes brackets for IPv6
      expect(info.hostname).toBe('[::1]');
      expect(info.port).toBe(3000);
    });

    test('handles IPv6 with full address', () => {
      // Need to include brackets in whitelist to match URL.hostname behavior
      process.env.HITL_WS_WHITELIST = 'localhost,[2001:db8::1]';
      const info = getWebSocketUrlInfo('ws://[2001:db8::1]:4000');
      // URL.hostname includes brackets for IPv6
      expect(info.hostname).toBe('[2001:db8::1]');
      expect(info.isWhitelisted).toBe(true);
    });
  });

  describe('path extraction', () => {
    test('extracts root path', () => {
      const info = getWebSocketUrlInfo('ws://localhost:4000');
      expect(info.path).toBe('/');
    });

    test('extracts simple path', () => {
      const info = getWebSocketUrlInfo('ws://localhost:4000/ws');
      expect(info.path).toBe('/ws');
    });

    test('extracts nested path', () => {
      const info = getWebSocketUrlInfo('ws://localhost:4000/api/v1/ws');
      expect(info.path).toBe('/api/v1/ws');
    });

    test('path includes query string in URL object', () => {
      // Note: URL.pathname doesn't include query string
      const info = getWebSocketUrlInfo('ws://localhost:4000/ws?token=abc');
      expect(info.path).toBe('/ws');
    });
  });

  describe('comprehensive info object', () => {
    test('provides complete info for complex valid URL', () => {
      const info = getWebSocketUrlInfo('wss://localhost:8443/socket/chat');
      expect(info).toEqual({
        valid: true,
        protocol: 'wss:',
        hostname: 'localhost',
        port: 8443,
        path: '/socket/chat',
        isSecure: true,
        isWhitelisted: true
      });
    });

    test('provides complete info for invalid URL with extractable parts', () => {
      // Invalid due to non-whitelisted host, but URL is parseable
      const info = getWebSocketUrlInfo('ws://badhost:4000/ws');
      expect(info.valid).toBe(false);
      expect(info.protocol).toBe('ws:');
      expect(info.hostname).toBe('badhost');
      expect(info.port).toBe(4000);
      expect(info.path).toBe('/ws');
      expect(info.isSecure).toBe(false);
      expect(info.isWhitelisted).toBe(false);
    });
  });
});
