/**
 * Content Extractor
 *
 * Extracts searchable text content from HookEvents for embedding.
 */

import type { HookEvent } from '../types';

const MAX_CONTENT_LENGTH = 4000;
const MAX_TOOL_INPUT_LENGTH = 1000;
const MAX_MESSAGE_LENGTH = 500;

/**
 * Extract searchable content from a HookEvent
 * @returns Extracted text content or null if nothing searchable
 */
export function extractSearchableContent(event: HookEvent): string | null {
  const parts: string[] = [];

  // Event type context
  if (event.hook_event_type) {
    parts.push(`Event: ${event.hook_event_type}`);
  }

  // Tool calls (most common and valuable for search)
  if (event.payload) {
    const toolContent = extractToolContent(event.payload);
    if (toolContent) {
      parts.push(toolContent);
    }
  }

  // Chat messages (user/assistant conversations)
  if (event.chat && Array.isArray(event.chat)) {
    const chatContent = extractChatContent(event.chat);
    if (chatContent) {
      parts.push(chatContent);
    }
  }

  // Summary (if available)
  if (event.summary) {
    parts.push(`Summary: ${event.summary}`);
  }

  // Human-in-the-loop questions
  if (event.humanInTheLoop?.question) {
    parts.push(`Question: ${event.humanInTheLoop.question}`);
  }

  if (parts.length === 0) {
    return null;
  }

  // Join and truncate
  const content = parts.join('\n\n');
  return content.slice(0, MAX_CONTENT_LENGTH);
}

/**
 * Extract content from tool-related payload
 */
function extractToolContent(payload: Record<string, any>): string | null {
  const parts: string[] = [];

  // Tool name
  if (payload.tool_name) {
    parts.push(`Tool: ${payload.tool_name}`);
  }

  // Tool input (arguments)
  if (payload.tool_input) {
    const inputStr = typeof payload.tool_input === 'string'
      ? payload.tool_input
      : JSON.stringify(payload.tool_input, null, 2);
    parts.push(`Input: ${inputStr.slice(0, MAX_TOOL_INPUT_LENGTH)}`);
  }

  // Tool output/result
  if (payload.tool_output) {
    const outputStr = typeof payload.tool_output === 'string'
      ? payload.tool_output
      : JSON.stringify(payload.tool_output);
    parts.push(`Output: ${outputStr.slice(0, MAX_TOOL_INPUT_LENGTH)}`);
  }

  // File paths (very valuable for search)
  if (payload.file_path) {
    parts.push(`File: ${payload.file_path}`);
  }

  // Command (for Bash tool)
  if (payload.command) {
    parts.push(`Command: ${payload.command.slice(0, 500)}`);
  }

  // Search patterns (for Grep/Glob)
  if (payload.pattern) {
    parts.push(`Pattern: ${payload.pattern}`);
  }

  // Content being written/edited
  if (payload.content && typeof payload.content === 'string') {
    parts.push(`Content: ${payload.content.slice(0, 500)}`);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Extract content from chat messages
 */
function extractChatContent(chat: any[]): string | null {
  if (!Array.isArray(chat) || chat.length === 0) {
    return null;
  }

  const parts: string[] = [];

  // Take last few messages (most relevant for context)
  const recentMessages = chat.slice(-5);

  for (const msg of recentMessages) {
    if (!msg) continue;

    const role = msg.role || 'unknown';
    let content = '';

    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      // Handle structured content (e.g., text blocks)
      content = msg.content
        .map((block: any) => {
          if (typeof block === 'string') return block;
          if (block.type === 'text') return block.text || '';
          if (block.type === 'tool_use') return `[Tool: ${block.name}]`;
          if (block.type === 'tool_result') return `[Tool Result]`;
          return '';
        })
        .filter(Boolean)
        .join(' ');
    }

    if (content) {
      parts.push(`${role}: ${content.slice(0, MAX_MESSAGE_LENGTH)}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

/**
 * Check if an event has searchable content
 */
export function hasSearchableContent(event: HookEvent): boolean {
  return extractSearchableContent(event) !== null;
}
