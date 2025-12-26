import {
  initDatabase,
  insertEvent,
  getFilterOptions,
  getRecentEvents,
  getEventsBySessionId,
  updateEventHITLResponse,
  getEventSummaries,
  getEventById,
  insertAudioCache,
  getAudioCacheByKey,
  getAudioCacheStats,
  deleteOldAudioCache,
  // Project management
  getProject,
  insertProject,
  updateProject,
  listProjects,
  archiveProject,
  getSession,
  listProjectSessions,
  ensureProjectExists,
  ensureSessionExists,
  updateProjectActivity,
  incrementSessionCounts,
  // Project settings
  getProjectSettings,
  getProjectSetting,
  insertProjectSetting,
  updateProjectSetting,
  deleteProjectSetting,
  bulkUpsertProjectSettings,
  // Session reassignment
  reassignSession,
  // Session updates
  updateSession,
  // Backfill
  backfillSessionMetadata,
  // Repository management
  getProjectRepositories,
  getRepository,
  insertRepository,
  updateRepository,
  deleteRepository,
  setPrimaryRepository,
  // Session settings
  getSessionSettings,
  getSessionSetting,
  insertSessionSetting,
  updateSessionSetting,
  deleteSessionSetting,
  bulkUpsertSessionSettings,
  getEffectiveSettings,
  // Orphaned sessions
  getUnassignedSessions,
  assignSessionToProject
} from './db';
import { handleTerminalWebSocket } from './terminal/gateway';
import type { HookEvent, HumanInTheLoopResponse, Project, ProjectSearchQuery, SettingType, ProjectSettingInput, RepositoryInput, SessionSettingInput, EventFilters, TimeRange } from './types';
import { toEventSummary } from './types';
import {
  createTheme,
  updateThemeById,
  getThemeById,
  searchThemes,
  deleteThemeById,
  exportThemeById,
  importTheme,
  getThemeStats
} from './theme';
import { EmbeddingQueue, extractSearchableContent } from './vector';

// ============================================
// Input Validation Helpers
// ============================================

/**
 * Validates an ID parameter to prevent path traversal and injection attacks.
 * Valid IDs contain only alphanumeric characters, colons, underscores, hyphens, and dots.
 */
function isValidId(id: string): boolean {
  if (!id || id.length === 0 || id.length > 256) return false;
  // Allow alphanumeric, colons (for source_app:session_id), underscores, hyphens, dots
  // Explicitly disallow path separators and SQL injection characters
  return /^[a-zA-Z0-9:_.\-]+$/.test(id);
}

/**
 * Validates a setting type parameter.
 */
const VALID_SETTING_TYPES = ['skills', 'agents', 'commands', 'permissions', 'hooks', 'output_styles'];
function isValidSettingType(type: string): type is SettingType {
  return VALID_SETTING_TYPES.includes(type);
}

/**
 * Safely decodes and validates an ID from URL path.
 * Returns null if the ID is invalid or potentially malicious.
 */
function safeDecodeId(encoded: string | undefined): string | null {
  if (!encoded) return null;
  try {
    const decoded = decodeURIComponent(encoded);
    return isValidId(decoded) ? decoded : null;
  } catch {
    return null; // Invalid encoding
  }
}

/**
 * Creates a standardized API error response.
 */
function apiError(message: string, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({
    success: false,
    error: message
  }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

// Initialize database (async)
await initDatabase();

// Initialize vector search (async, with graceful degradation)
const embeddingQueue = new EmbeddingQueue();
try {
  await embeddingQueue.init();
  console.log('🔍 Semantic search enabled');
} catch (error) {
  console.warn('⚠️ Semantic search disabled:', error);
}

// Store WebSocket clients
const wsClients = new Set<any>();

// Validate WebSocket URL to prevent SSRF attacks
function validateWebSocketUrl(wsUrl: string): boolean {
  try {
    const url = new URL(wsUrl);
    // Only allow ws/wss protocols
    if (!['ws:', 'wss:'].includes(url.protocol)) {
      console.warn(`[HITL] Invalid WebSocket protocol: ${url.protocol}`);
      return false;
    }
    // Only allow localhost connections to prevent SSRF
    const allowedHosts = ['localhost', '127.0.0.1', '[::1]', '::1'];
    if (!allowedHosts.includes(url.hostname)) {
      console.warn(`[HITL] WebSocket URL rejected - only localhost allowed: ${url.hostname}`);
      return false;
    }
    // Validate port is reasonable (1024-65535)
    const port = url.port ? parseInt(url.port) : (url.protocol === 'wss:' ? 443 : 80);
    if (port < 1024 || port > 65535) {
      console.warn(`[HITL] WebSocket port out of range: ${port}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[HITL] Invalid WebSocket URL format: ${wsUrl}`);
    return false;
  }
}

// Helper function to send response to agent via WebSocket
async function sendResponseToAgent(
  wsUrl: string,
  response: HumanInTheLoopResponse
): Promise<void> {
  // Validate URL before connecting (SSRF prevention)
  if (!validateWebSocketUrl(wsUrl)) {
    throw new Error(`Invalid WebSocket URL: ${wsUrl}`);
  }

  console.log(`[HITL] Connecting to agent WebSocket: ${wsUrl}`);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isResolved = false;
    let connectionTimeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    };

    // Connection timeout (5 seconds)
    connectionTimeout = setTimeout(() => {
      if (!isResolved) {
        console.warn('[HITL] WebSocket connection timeout');
        cleanup();
        isResolved = true;
        reject(new Error('WebSocket connection timeout'));
      }
    }, 5000);

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (isResolved) return;
        console.log('[HITL] WebSocket connection opened, sending response...');

        try {
          ws!.send(JSON.stringify(response));
          console.log('[HITL] Response sent successfully');

          // Wait longer to ensure message fully transmits before closing
          setTimeout(() => {
            cleanup();
            if (!isResolved) {
              isResolved = true;
              resolve();
            }
          }, 500);
        } catch (error) {
          console.error('[HITL] Error sending message:', error);
          cleanup();
          if (!isResolved) {
            isResolved = true;
            reject(error);
          }
        }
      };

      ws.onerror = (error) => {
        console.error('[HITL] WebSocket error:', error);
        cleanup();
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      };

      ws.onclose = () => {
        console.log('[HITL] WebSocket connection closed');
      };

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!isResolved) {
          console.error('[HITL] Timeout sending response to agent');
          cleanup();
          isResolved = true;
          reject(new Error('Timeout sending response to agent'));
        }
      }, 5000);

    } catch (error) {
      console.error('[HITL] Error creating WebSocket:', error);
      cleanup();
      if (!isResolved) {
        isResolved = true;
        reject(error);
      }
    }
  });
}

// Create Bun server with HTTP and WebSocket support
const server = Bun.serve({
  hostname: '0.0.0.0', // Allow external connections (Traefik)
  port: parseInt(process.env.SERVER_PORT || '4000'),
  
  async fetch(req: Request) {
    const url = new URL(req.url);
    
    // Allowed origins for CORS
    const ALLOWED_ORIGINS = [
      'http://localhost:5173',
      'http://192.168.15.7:5173',
      'https://cli.di4.dev',
      'http://cli.di4.dev',
      'https://observability.di4.dev',
      'http://observability.di4.dev',
      'https://hooks.di4.dev',
      'http://hooks.di4.dev',
      'https://ai.di4.dev',
      'http://ai.di4.dev'
    ];

    // Handle CORS with dynamic origin
    const origin = req.headers.get('origin') || '';
    // Allow localhost/LAN origins in dev, plus any *.di4.dev domain
    const isDevOrigin = origin.startsWith('http://localhost:') ||
                        origin.startsWith('http://127.0.0.1:') ||
                        origin.startsWith('http://172.') ||
                        origin.startsWith('http://192.168.') ||
                        origin.startsWith('http://10.');
    const isPublicDomain = origin.endsWith('.di4.dev') || origin.endsWith('.di4.ru');
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) || isDevOrigin || isPublicDomain ? origin : ALLOWED_ORIGINS[0];

    const headers = {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
    };
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    // GET /health - Health check endpoint
    if (url.pathname === '/health' && req.method === 'GET') {
      return new Response(JSON.stringify({
        status: 'ok',
        timestamp: Date.now(),
        uptime: process.uptime()
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /events - Receive new events
    if (url.pathname === '/events' && req.method === 'POST') {
      try {
        const event: HookEvent = await req.json();
        
        // Validate required fields
        if (!event.source_app || !event.session_id || !event.hook_event_type || !event.payload) {
          return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }
        
        // Auto-register project and session
        const projectId = event.source_app || 'orphaned:unknown';
        const project = await ensureProjectExists(projectId);
        const session = await ensureSessionExists(projectId, event.session_id, event.model_name);

        // Extract session metadata from SessionStart events
        const hookEventName = event.payload?.hook_event_name || event.hook_event_type;
        if (hookEventName === 'SessionStart') {
          const metadata: any = {};
          if (event.payload?.cwd) metadata.cwd = event.payload.cwd;
          if (event.payload?.transcript_path) metadata.transcriptPath = event.payload.transcript_path;
          if (event.payload?.permission_mode) metadata.permissionMode = event.payload.permission_mode;

          if (Object.keys(metadata).length > 0) {
            await updateSession(session.id, metadata);
          }
        }

        // Extract summary from Stop events
        if (hookEventName === 'Stop' && event.payload?.summary) {
          await updateSession(session.id, {
            summary: event.payload.summary,
            status: 'completed'
          });
        }

        // Add project_id to event
        const eventWithProject = { ...event, project_id: projectId };

        // Insert event into database
        const savedEvent = await insertEvent(eventWithProject);

        // Update counts and activity
        const isToolCall = event.hook_event_type.includes('ToolUse');
        await incrementSessionCounts(session.id, 1, isToolCall ? 1 : 0);
        await updateProjectActivity(projectId, event.session_id);

        // Enqueue for semantic search indexing (non-blocking)
        const searchableContent = extractSearchableContent(savedEvent);
        if (searchableContent && embeddingQueue.isEnabled()) {
          embeddingQueue.enqueue(
            savedEvent.id!,
            savedEvent.session_id,
            projectId,
            searchableContent
          );
        }

        // Broadcast to all WebSocket clients (use summary for performance)
        const eventSummary = toEventSummary(savedEvent);
        const message = JSON.stringify({ type: 'event', data: eventSummary });
        wsClients.forEach(client => {
          try {
            client.send(message);
          } catch (err) {
            // Client disconnected, remove from set
            wsClients.delete(client);
          }
        });

        return new Response(JSON.stringify(savedEvent), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error processing event:', error);
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /events/filter-options - Get available filter options
    if (url.pathname === '/events/filter-options' && req.method === 'GET') {
      const options = await getFilterOptions();
      return new Response(JSON.stringify(options), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /events/recent - Get recent events (DEPRECATED - use /events/summaries for better performance)
    if (url.pathname === '/events/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '300');
      const events = await getRecentEvents(limit);
      return new Response(JSON.stringify(events), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /events/summaries - Get lightweight event summaries with filters
    if (url.pathname === '/events/summaries' && req.method === 'GET') {
      const filters: EventFilters = {
        timeRange: (url.searchParams.get('timeRange') as TimeRange) || undefined,
        from: url.searchParams.get('from') ? parseInt(url.searchParams.get('from')!) : undefined,
        to: url.searchParams.get('to') ? parseInt(url.searchParams.get('to')!) : undefined,
        source_app: url.searchParams.get('source_app') || undefined,
        session_id: url.searchParams.get('session_id') || undefined,
        hook_event_type: url.searchParams.get('type') || undefined,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : 300,
        offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : 0
      };

      const summaries = await getEventSummaries(filters);
      return new Response(JSON.stringify({
        success: true,
        data: summaries,
        meta: {
          count: summaries.length,
          filters
        }
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /events/:id - Get full event detail by ID
    if (url.pathname.match(/^\/events\/\d+$/) && req.method === 'GET') {
      const id = parseInt(url.pathname.split('/')[2]);
      const event = await getEventById(id);

      if (!event) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Event not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        data: event
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /events/:id/respond - Respond to HITL request
    if (url.pathname.match(/^\/events\/\d+\/respond$/) && req.method === 'POST') {
      const id = parseInt(url.pathname.split('/')[2]);

      try {
        const response: HumanInTheLoopResponse = await req.json();
        response.respondedAt = Date.now();

        // Update event in database
        const updatedEvent = await updateEventHITLResponse(id, response);

        if (!updatedEvent) {
          return new Response(JSON.stringify({ error: 'Event not found' }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Send response to agent via WebSocket
        if (updatedEvent.humanInTheLoop?.responseWebSocketUrl) {
          try {
            await sendResponseToAgent(
              updatedEvent.humanInTheLoop.responseWebSocketUrl,
              response
            );
          } catch (error) {
            console.error('Failed to send response to agent:', error);
            // Don't fail the request if we can't reach the agent
          }
        }

        // Broadcast updated event to all connected clients (use summary for performance)
        const updatedSummary = toEventSummary(updatedEvent);
        const message = JSON.stringify({ type: 'event', data: updatedSummary });
        wsClients.forEach(client => {
          try {
            client.send(message);
          } catch (err) {
            wsClients.delete(client);
          }
        });

        return new Response(JSON.stringify(updatedEvent), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error processing HITL response:', error);
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /events/:id/response - Poll for HITL response (for hooks that can't receive WebSocket)
    if (url.pathname.match(/^\/events\/\d+\/response$/) && req.method === 'GET') {
      const id = parseInt(url.pathname.split('/')[2]);

      try {
        const event = await getEventById(id);

        if (!event) {
          return new Response(JSON.stringify({ success: false, error: 'Event not found' }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Validate this is a HITL event
        if (!event.humanInTheLoop) {
          return new Response(JSON.stringify({ success: false, error: 'Event is not a HITL request' }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Check if there's a HITL response
        if (event.humanInTheLoopStatus?.status === 'responded' && event.humanInTheLoopStatus?.response) {
          return new Response(JSON.stringify({
            success: true,
            data: event.humanInTheLoopStatus.response
          }), {
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // No response yet - return 202 Accepted (processing) with Retry-After hint
        return new Response(JSON.stringify({
          success: false,
          error: 'No response yet',
          status: event.humanInTheLoopStatus?.status || 'pending'
        }), {
          status: 202,
          headers: {
            ...headers,
            'Content-Type': 'application/json',
            'Retry-After': '2'  // Suggest polling every 2 seconds
          }
        });
      } catch (error) {
        console.error('Error fetching HITL response:', error);
        return new Response(JSON.stringify({ success: false, error: 'Server error' }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // Theme API endpoints

    // POST /api/themes - Create a new theme
    if (url.pathname === '/api/themes' && req.method === 'POST') {
      try {
        const themeData = await req.json();
        const result = await createTheme(themeData);
        
        const status = result.success ? 201 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error creating theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid request body' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /api/themes - Search themes
    if (url.pathname === '/api/themes' && req.method === 'GET') {
      const query = {
        query: url.searchParams.get('query') || undefined,
        isPublic: url.searchParams.get('isPublic') ? url.searchParams.get('isPublic') === 'true' : undefined,
        authorId: url.searchParams.get('authorId') || undefined,
        sortBy: url.searchParams.get('sortBy') as any || undefined,
        sortOrder: url.searchParams.get('sortOrder') as any || undefined,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
        offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
      };
      
      const result = await searchThemes(query);
      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /api/themes/:id - Get a specific theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      const result = await getThemeById(id);
      const status = result.success ? 200 : 404;
      return new Response(JSON.stringify(result), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // PUT /api/themes/:id - Update a theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'PUT') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      try {
        const updates = await req.json();
        const result = await updateThemeById(id, updates);
        
        const status = result.success ? 200 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid request body' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // DELETE /api/themes/:id - Delete a theme
    if (url.pathname.startsWith('/api/themes/') && req.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      if (!id) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Theme ID is required' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      const authorId = url.searchParams.get('authorId');
      const result = await deleteThemeById(id, authorId || undefined);
      
      const status = result.success ? 200 : (result.error?.includes('not found') ? 404 : 403);
      return new Response(JSON.stringify(result), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /api/themes/:id/export - Export a theme
    if (url.pathname.match(/^\/api\/themes\/[^\/]+\/export$/) && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      
      const result = await exportThemeById(id);
      if (!result.success) {
        const status = result.error?.includes('not found') ? 404 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      return new Response(JSON.stringify(result.data), {
        headers: { 
          ...headers, 
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${result.data.theme.name}.json"`
        }
      });
    }
    
    // POST /api/themes/import - Import a theme
    if (url.pathname === '/api/themes/import' && req.method === 'POST') {
      try {
        const importData = await req.json();
        const authorId = url.searchParams.get('authorId');
        
        const result = await importTheme(importData, authorId || undefined);
        
        const status = result.success ? 201 : 400;
        return new Response(JSON.stringify(result), {
          status,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error importing theme:', error);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Invalid import data' 
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // GET /api/themes/stats - Get theme statistics
    if (url.pathname === '/api/themes/stats' && req.method === 'GET') {
      const result = await getThemeStats();
      return new Response(JSON.stringify(result), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ============= AUDIO CACHE API =============

    // POST /api/audio - Store audio in cache
    if (url.pathname === '/api/audio' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { key, audioData, mimeType, voiceId, textHash, sourceApp } = body;

        if (!key || !audioData) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing required fields: key and audioData'
          }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Check if already exists
        const existing = await getAudioCacheByKey(key);
        if (existing) {
          return new Response(JSON.stringify({
            success: true,
            data: { id: existing.id, key: existing.key },
            message: 'Audio already cached'
          }), {
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Calculate size from base64
        const sizeBytes = Math.ceil((audioData.length * 3) / 4);

        const entry = await insertAudioCache({
          key,
          audioData,
          mimeType: mimeType || 'audio/mpeg',
          voiceId,
          textHash,
          sourceApp,
          sizeBytes
        });

        return new Response(JSON.stringify({
          success: true,
          data: { id: entry.id, key: entry.key },
          message: 'Audio cached successfully'
        }), {
          status: 201,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Audio cache error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to cache audio'
        }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/audio/:key - Retrieve audio from cache
    if (url.pathname.startsWith('/api/audio/') && req.method === 'GET') {
      const key = decodeURIComponent(url.pathname.slice('/api/audio/'.length));

      if (!key) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing audio key'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const entry = await getAudioCacheByKey(key);

      if (!entry) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Audio not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      // Return audio as base64 JSON or as binary
      const returnBinary = url.searchParams.get('binary') === 'true';

      if (returnBinary) {
        const buffer = Buffer.from(entry.audioData, 'base64');
        return new Response(buffer, {
          headers: {
            ...headers,
            'Content-Type': entry.mimeType,
            'Content-Length': buffer.length.toString()
          }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        data: entry
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/audio-stats - Get audio cache statistics
    if (url.pathname === '/api/audio-stats' && req.method === 'GET') {
      const stats = await getAudioCacheStats();
      return new Response(JSON.stringify({
        success: true,
        data: stats
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // DELETE /api/audio/cleanup - Cleanup old audio entries
    if (url.pathname === '/api/audio/cleanup' && req.method === 'DELETE') {
      const days = parseInt(url.searchParams.get('days') || '7');
      const deleted = await deleteOldAudioCache(days * 24 * 60 * 60 * 1000);
      return new Response(JSON.stringify({
        success: true,
        data: { deleted },
        message: `Deleted ${deleted} old audio entries`
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ============= PROJECT API =============

    // GET /api/projects - List all projects
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const query: ProjectSearchQuery = {
        status: url.searchParams.get('status') as any || undefined,
        query: url.searchParams.get('query') || undefined,
        sortBy: url.searchParams.get('sortBy') as any || undefined,
        sortOrder: url.searchParams.get('sortOrder') as any || undefined,
        limit: url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
        offset: url.searchParams.get('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
      };

      const projects = await listProjects(query);
      return new Response(JSON.stringify({
        success: true,
        data: projects
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/projects/:id - Get project details
    if (url.pathname.match(/^\/api\/projects\/[^\/]+$/) && req.method === 'GET' && !url.pathname.includes('/sessions')) {
      const pathParts = url.pathname.split('/');
      const id = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      if (!id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const project = await getProject(id);
      if (!project) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        data: project
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/projects - Create project (manual)
    if (url.pathname === '/api/projects' && req.method === 'POST') {
      try {
        const body = await req.json() as { id?: string; displayName?: string; description?: string; gitRemoteUrl?: string; localPath?: string; status?: string; metadata?: Record<string, unknown> };

        if (!body.id) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Project ID is required'
          }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        // Check if already exists
        const existing = await getProject(body.id);
        if (existing) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Project already exists'
          }), {
            status: 409,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        const project = await insertProject({
          id: body.id,
          displayName: body.displayName,
          description: body.description,
          gitRemoteUrl: body.gitRemoteUrl,
          localPath: body.localPath,
          status: (body.status as 'active' | 'archived' | 'paused') || 'active',
          metadata: body.metadata
        });

        return new Response(JSON.stringify({
          success: true,
          data: project
        }), {
          status: 201,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error creating project:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid request body'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // PUT /api/projects/:id - Update project
    if (url.pathname.match(/^\/api\/projects\/[^\/]+$/) && req.method === 'PUT') {
      const pathParts = url.pathname.split('/');
      const id = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      if (!id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      try {
        const updates = await req.json() as Partial<Project>;
        const project = await updateProject(id, updates);

        if (!project) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Project not found'
          }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          data: project
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating project:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid request body'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // DELETE /api/projects/:id - Archive project
    if (url.pathname.match(/^\/api\/projects\/[^\/]+$/) && req.method === 'DELETE') {
      const pathParts = url.pathname.split('/');
      const id = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      if (!id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const success = await archiveProject(id);
      if (!success) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Project archived'
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/projects/:id/sessions - List project sessions
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/sessions$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const id = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      if (!id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const project = await getProject(id);
      if (!project) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const sessions = await listProjectSessions(id);
      return new Response(JSON.stringify({
        success: true,
        data: sessions
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/sessions/:id - Get session details
    // Note: negative lookahead excludes literal paths like /unassigned and /backfill-metadata
    if (url.pathname.match(/^\/api\/sessions\/(?!unassigned$|backfill-metadata$)[^\/]+$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const id = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      if (!id) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Session ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const session = await getSession(id);
      if (!session) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Session not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        data: session
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/sessions/:id/events - Get all events for a session
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/events$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const sessionId = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      if (!sessionId) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Session ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const events = await getEventsBySessionId(sessionId);
      return new Response(JSON.stringify({
        success: true,
        data: events
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ============= TMUX INTEGRATION API =============

    // GET /api/sessions/:id/tmux - Get tmux availability for a session
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/tmux$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const sessionId = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';

      if (!sessionId) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Session ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      try {
        const { findTmuxWindow, buildTtydUrl } = await import('./tmux');
        const result = await findTmuxWindow(sessionId);

        if (result.found && result.info) {
          const ttydUrl = buildTtydUrl(result.info.target);
          return new Response(JSON.stringify({
            success: true,
            data: {
              available: true,
              tmuxInfo: result.info,
              ttydUrl,
              lastChecked: Date.now()
            }
          }), {
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          data: {
            available: false,
            error: result.error,
            lastChecked: Date.now()
          }
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('[API] Tmux query error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to query tmux status'
        }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/tmux/sessions - List all active CCC sessions in tmux
    if (url.pathname === '/api/tmux/sessions' && req.method === 'GET') {
      try {
        const { getTmuxSessionMapping, buildTtydUrl } = await import('./tmux');
        const mapping = await getTmuxSessionMapping();
        const sessions = [];

        for (const [sessionId, tmuxInfo] of mapping.entries()) {
          // Get project info from database if available
          const session = await getSession(sessionId);
          const project = session ? await getProject(session.projectId) : null;

          sessions.push({
            sessionId,
            tmuxInfo,
            ttydUrl: buildTtydUrl(tmuxInfo.target),
            projectId: session?.projectId,
            projectName: project?.displayName || project?.id,
            session: session ? {
              startedAt: session.startedAt,
              modelName: session.modelName,
              cwd: session.cwd
            } : null
          });
        }

        return new Response(JSON.stringify({
          success: true,
          data: sessions,
          count: sessions.length
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('[API] Tmux listing error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to list tmux sessions'
        }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // ============= PROJECT SETTINGS API =============

    // GET /api/projects/:id/settings - Get all settings for a project
    // GET /api/projects/:id/settings/:type - Get settings of a specific type
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/settings(\/[^\/]+)?$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const projectId = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      const settingType = pathParts[5] ? decodeURIComponent(pathParts[5]) as SettingType : undefined;

      if (!projectId) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const project = await getProject(projectId);
      if (!project) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const settings = await getProjectSettings(projectId, settingType);
      return new Response(JSON.stringify({
        success: true,
        data: settings
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/projects/:id/settings/:type - Bulk upsert settings of a type
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/settings\/[^\/]+$/) && req.method === 'POST') {
      const pathParts = url.pathname.split('/');
      const projectId = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      const settingType = pathParts[5] ? decodeURIComponent(pathParts[5]) as SettingType : '';

      if (!projectId || !settingType) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID and setting type are required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const validTypes: SettingType[] = ['skills', 'agents', 'commands', 'permissions', 'hooks', 'output_styles'];
      if (!validTypes.includes(settingType as SettingType)) {
        return new Response(JSON.stringify({
          success: false,
          error: `Invalid setting type. Must be one of: ${validTypes.join(', ')}`
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      try {
        const body = await req.json() as { settings: ProjectSettingInput[] };
        if (!body.settings || !Array.isArray(body.settings)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Request body must contain a "settings" array'
          }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        const settings = await bulkUpsertProjectSettings(projectId, settingType as SettingType, body.settings);
        return new Response(JSON.stringify({
          success: true,
          data: settings
        }), {
          status: 201,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error upserting project settings:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid request body'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // PUT /api/projects/:id/settings/:type/:key - Update a specific setting
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/settings\/[^\/]+\/[^\/]+$/) && req.method === 'PUT') {
      const pathParts = url.pathname.split('/');
      const projectId = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      const settingType = pathParts[5] ? decodeURIComponent(pathParts[5]) as SettingType : '';
      const settingKey = pathParts[6] ? decodeURIComponent(pathParts[6]) : '';

      if (!projectId || !settingType || !settingKey) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID, setting type, and setting key are required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      try {
        const body = await req.json() as Partial<ProjectSettingInput>;

        // Check if setting exists
        const existing = await getProjectSetting(projectId, settingType as SettingType, settingKey);

        let setting;
        if (existing) {
          setting = await updateProjectSetting(existing.id, body);
        } else {
          // Create new setting if it doesn't exist
          setting = await insertProjectSetting(projectId, settingType as SettingType, {
            settingKey,
            settingValue: body.settingValue || {},
            enabled: body.enabled
          });
        }

        return new Response(JSON.stringify({
          success: true,
          data: setting
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating project setting:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid request body'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // DELETE /api/projects/:id/settings/:type/:key - Delete a specific setting
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/settings\/[^\/]+\/[^\/]+$/) && req.method === 'DELETE') {
      const pathParts = url.pathname.split('/');
      const projectId = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';
      const settingType = pathParts[5] ? decodeURIComponent(pathParts[5]) as SettingType : '';
      const settingKey = pathParts[6] ? decodeURIComponent(pathParts[6]) : '';

      if (!projectId || !settingType || !settingKey) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project ID, setting type, and setting key are required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const existing = await getProjectSetting(projectId, settingType as SettingType, settingKey);
      if (!existing) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Setting not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      await deleteProjectSetting(existing.id);
      return new Response(JSON.stringify({
        success: true,
        message: 'Setting deleted'
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ============= REPOSITORY API =============

    // GET /api/projects/:id/repositories - Get all repositories for a project
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/repositories$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const projectId = safeDecodeId(pathParts[3]);

      if (!projectId) {
        return apiError('Invalid or missing Project ID', 400, headers);
      }

      const repos = await getProjectRepositories(projectId);
      return new Response(JSON.stringify({
        success: true,
        data: repos
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/projects/:id/repositories - Add a repository to a project
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/repositories$/) && req.method === 'POST') {
      const pathParts = url.pathname.split('/');
      const projectId = safeDecodeId(pathParts[3]);

      if (!projectId) {
        return apiError('Invalid or missing Project ID', 400, headers);
      }

      try {
        const body = await req.json() as RepositoryInput;
        if (!body.name || !isValidId(body.name)) {
          return apiError('Valid repository name is required', 400, headers);
        }

        const repo = await insertRepository(projectId, body);
        return new Response(JSON.stringify({
          success: true,
          data: repo
        }), {
          status: 201,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error adding repository:', error);
        return apiError('Failed to add repository', 400, headers);
      }
    }

    // PUT /api/projects/:id/repositories/:repoId - Update a repository
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/repositories\/[^\/]+$/) && req.method === 'PUT') {
      const pathParts = url.pathname.split('/');
      const projectId = safeDecodeId(pathParts[3]);
      const repoId = safeDecodeId(pathParts[5]);

      if (!projectId || !repoId) {
        return apiError('Invalid or missing Project ID and Repository ID', 400, headers);
      }

      try {
        const body = await req.json() as Partial<RepositoryInput>;
        const repo = await updateRepository(repoId, body);

        if (!repo) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Repository not found'
          }), {
            status: 404,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          data: repo
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating repository:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to update repository'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // DELETE /api/projects/:id/repositories/:repoId - Delete a repository
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/repositories\/[^\/]+$/) && req.method === 'DELETE') {
      const pathParts = url.pathname.split('/');
      const projectId = safeDecodeId(pathParts[3]);
      const repoId = safeDecodeId(pathParts[5]);

      if (!projectId || !repoId) {
        return apiError('Invalid or missing Project ID and Repository ID', 400, headers);
      }

      const success = await deleteRepository(repoId);
      if (!success) {
        return apiError('Repository not found', 404, headers);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Repository deleted'
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // PUT /api/projects/:id/repositories/:repoId/primary - Set as primary repository
    if (url.pathname.match(/^\/api\/projects\/[^\/]+\/repositories\/[^\/]+\/primary$/) && req.method === 'PUT') {
      const pathParts = url.pathname.split('/');
      const projectId = safeDecodeId(pathParts[3]);
      const repoId = safeDecodeId(pathParts[5]);

      if (!projectId || !repoId) {
        return apiError('Invalid or missing Project ID and Repository ID', 400, headers);
      }

      const success = await setPrimaryRepository(projectId, repoId);
      if (!success) {
        return apiError('Repository not found or does not belong to this project', 404, headers);
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Repository set as primary'
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ============= SESSION SETTINGS API =============

    // GET /api/sessions/:id/settings - Get effective settings (merged project + session)
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/settings$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const sessionId = safeDecodeId(pathParts[3]);
      const typeParam = url.searchParams.get('type');
      const type = typeParam && isValidSettingType(typeParam) ? typeParam : undefined;

      if (!sessionId) {
        return apiError('Invalid or missing Session ID', 400, headers);
      }

      const settings = await getEffectiveSettings(sessionId, type || undefined);
      return new Response(JSON.stringify({
        success: true,
        data: settings
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // GET /api/sessions/:id/settings/overrides - Get only session-level overrides
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/settings\/overrides$/) && req.method === 'GET') {
      const pathParts = url.pathname.split('/');
      const sessionId = safeDecodeId(pathParts[3]);
      const typeParam = url.searchParams.get('type');
      const type = typeParam && isValidSettingType(typeParam) ? typeParam : undefined;

      if (!sessionId) {
        return apiError('Invalid or missing Session ID', 400, headers);
      }

      const overrides = await getSessionSettings(sessionId, type);
      return new Response(JSON.stringify({
        success: true,
        data: overrides
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/sessions/:id/settings/:type - Bulk upsert session settings
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/settings\/[^\/]+$/) && req.method === 'POST') {
      const pathParts = url.pathname.split('/');
      const sessionId = safeDecodeId(pathParts[3]);
      const settingTypeRaw = pathParts[5] ? decodeURIComponent(pathParts[5]) : '';

      if (!sessionId) {
        return apiError('Invalid or missing Session ID', 400, headers);
      }

      if (!isValidSettingType(settingTypeRaw)) {
        return apiError('Invalid setting type', 400, headers);
      }

      try {
        const body = await req.json() as { settings: SessionSettingInput[] };
        if (!body.settings || !Array.isArray(body.settings)) {
          return apiError('Settings array is required', 400, headers);
        }

        const results = await bulkUpsertSessionSettings(sessionId, settingTypeRaw, body.settings);
        return new Response(JSON.stringify({
          success: true,
          data: results
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error upserting session settings:', error);
        return apiError('Invalid request body', 400, headers);
      }
    }

    // PUT /api/sessions/:id/settings/:type/:key - Update a specific session setting
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/settings\/[^\/]+\/[^\/]+$/) && req.method === 'PUT') {
      const pathParts = url.pathname.split('/');
      const sessionId = safeDecodeId(pathParts[3]);
      const settingTypeRaw = pathParts[5] ? decodeURIComponent(pathParts[5]) : '';
      const settingKey = safeDecodeId(pathParts[6]);

      if (!sessionId || !settingKey) {
        return apiError('Invalid or missing Session ID and setting key', 400, headers);
      }

      if (!isValidSettingType(settingTypeRaw)) {
        return apiError('Invalid setting type', 400, headers);
      }

      try {
        const body = await req.json() as SessionSettingInput;
        const existing = await getSessionSetting(sessionId, settingTypeRaw, settingKey);

        let result;
        if (existing) {
          result = await updateSessionSetting(existing.id, body);
        } else {
          result = await insertSessionSetting(sessionId, settingTypeRaw, {
            settingKey,
            settingValue: body.settingValue,
            overrideMode: body.overrideMode || 'replace',
            enabled: body.enabled
          });
        }

        return new Response(JSON.stringify({
          success: true,
          data: result
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error updating session setting:', error);
        return apiError('Invalid request body', 400, headers);
      }
    }

    // DELETE /api/sessions/:id/settings/:type/:key - Delete a session setting override
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/settings\/[^\/]+\/[^\/]+$/) && req.method === 'DELETE') {
      const pathParts = url.pathname.split('/');
      const sessionId = safeDecodeId(pathParts[3]);
      const settingTypeRaw = pathParts[5] ? decodeURIComponent(pathParts[5]) : '';
      const settingKey = safeDecodeId(pathParts[6]);

      if (!sessionId || !settingKey) {
        return apiError('Invalid or missing Session ID and setting key', 400, headers);
      }

      if (!isValidSettingType(settingTypeRaw)) {
        return apiError('Invalid setting type', 400, headers);
      }

      const existing = await getSessionSetting(sessionId, settingTypeRaw, settingKey);
      if (!existing) {
        return apiError('Session setting not found', 404, headers);
      }

      await deleteSessionSetting(existing.id);
      return new Response(JSON.stringify({
        success: true,
        message: 'Session setting deleted'
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // ============= ORPHANED SESSIONS API =============

    // GET /api/sessions/unassigned - Get sessions from auto-created projects
    if (url.pathname === '/api/sessions/unassigned' && req.method === 'GET') {
      const sessions = await getUnassignedSessions();
      return new Response(JSON.stringify({
        success: true,
        data: sessions
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // POST /api/sessions/:id/assign - Assign an orphaned session to a project
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/assign$/) && req.method === 'POST') {
      const pathParts = url.pathname.split('/');
      const sessionId = safeDecodeId(pathParts[3]);

      if (!sessionId) {
        return apiError('Invalid or missing Session ID', 400, headers);
      }

      try {
        const body = await req.json() as { projectId: string };
        const projectId = body.projectId && isValidId(body.projectId) ? body.projectId : null;

        if (!projectId) {
          return apiError('Valid target project ID is required', 400, headers);
        }

        const session = await assignSessionToProject(sessionId, projectId);
        if (!session) {
          return apiError('Session not found or assignment failed', 404, headers);
        }

        return new Response(JSON.stringify({
          success: true,
          data: session,
          message: `Session assigned to project ${projectId}`
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error assigning session:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Failed to assign session'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // ============= SESSION REASSIGNMENT API =============

    // PUT /api/sessions/:id/reassign - Reassign session to a different project
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+\/reassign$/) && req.method === 'PUT') {
      const pathParts = url.pathname.split('/');
      const sessionId = pathParts[3] ? decodeURIComponent(pathParts[3]) : '';

      if (!sessionId) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Session ID is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      try {
        const body = await req.json() as { projectId: string };
        if (!body.projectId) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Target project ID is required'
          }), {
            status: 400,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        const result = await reassignSession(sessionId, body.projectId);
        return new Response(JSON.stringify({
          success: true,
          data: result,
          message: `Session reassigned to ${body.projectId}. Moved ${result.movedEvents} events.`
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error reassigning session:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to reassign session';
        return new Response(JSON.stringify({
          success: false,
          error: errorMessage
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // POST /api/sessions/backfill-metadata - Backfill session metadata from events
    if (url.pathname === '/api/sessions/backfill-metadata' && req.method === 'POST') {
      try {
        const result = await backfillSessionMetadata();
        return new Response(JSON.stringify({
          success: true,
          data: result,
          message: `Backfill complete. Updated ${result.updated} sessions, skipped ${result.skipped}.`
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Error backfilling session metadata:', error);
        return new Response(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to backfill session metadata'
        }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // ============= SEMANTIC SEARCH API =============

    // GET /api/search - Semantic search across all events
    if (url.pathname === '/api/search' && req.method === 'GET') {
      const query = url.searchParams.get('q');
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const sessionId = url.searchParams.get('session_id') || undefined;
      const projectId = url.searchParams.get('project_id') || undefined;

      if (!query) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Query parameter "q" is required'
        }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      if (!embeddingQueue.isEnabled()) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Semantic search is not available',
          data: []
        }), {
          status: 503,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      try {
        let results;

        if (sessionId) {
          results = await embeddingQueue.searchInSession(sessionId, query, limit);
        } else if (projectId) {
          results = await embeddingQueue.searchInProject(projectId, query, limit);
        } else {
          results = await embeddingQueue.search(query, limit);
        }

        return new Response(JSON.stringify({
          success: true,
          data: results,
          count: results.length
        }), {
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      } catch (error) {
        console.error('Search error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: 'Search failed',
          data: []
        }), {
          status: 500,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
    }

    // GET /api/search/stats - Get vector search statistics
    if (url.pathname === '/api/search/stats' && req.method === 'GET') {
      const stats = await embeddingQueue.getStats();
      return new Response(JSON.stringify({
        success: true,
        data: stats
      }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    // WebSocket upgrade
    if (url.pathname === '/stream') {
      const success = server.upgrade(req);
      if (success) {
        return undefined;
      }
    }

    // Terminal gateway WebSocket upgrade - web clients
    if (url.pathname === '/terminal') {
      const success = server.upgrade(req, {
        data: { path: '/terminal' }
      });
      if (success) {
        return undefined;
      }
    }

    // Terminal gateway WebSocket upgrade - remote agents
    if (url.pathname === '/agent') {
      const success = server.upgrade(req, {
        data: { path: '/agent' }
      });
      if (success) {
        return undefined;
      }
    }

    // Default response
    return new Response('MMM - Multi Manager Mobile Server', {
      headers: { ...headers, 'Content-Type': 'text/plain' }
    });
  },
  
  websocket: {
    async open(ws) {
      const path = (ws.data as any)?.path;

      // Route to terminal gateway for /terminal and /agent paths
      if (path === '/terminal' || path === '/agent') {
        console.log(`Terminal gateway WebSocket connected: ${path}`);
        handleTerminalWebSocket(ws as any, path);
        return;
      }

      // Default event stream handler for /stream
      console.log('WebSocket client connected');
      wsClients.add(ws);

      // Send recent event summaries on connection (lightweight, no payload)
      const summaries = await getEventSummaries({ limit: 300 });
      ws.send(JSON.stringify({ type: 'initial', data: summaries }));
    },

    message(ws, message) {
      const path = (ws.data as any)?.path;

      // Terminal gateway messages are handled by the gateway itself
      if (path === '/terminal' || path === '/agent') {
        return;
      }

      // Handle any client messages if needed
      console.log('Received message:', message);
    },

    close(ws) {
      const path = (ws.data as any)?.path;

      // Terminal gateway cleanup is handled by the gateway itself
      if (path === '/terminal' || path === '/agent') {
        console.log(`Terminal gateway WebSocket disconnected: ${path}`);
        return;
      }

      console.log('WebSocket client disconnected');
      wsClients.delete(ws);
    },

    error(ws, error) {
      const path = (ws.data as any)?.path;

      // Terminal gateway errors are handled by the gateway itself
      if (path === '/terminal' || path === '/agent') {
        console.error(`Terminal gateway WebSocket error on ${path}:`, error);
        return;
      }

      console.error('WebSocket error:', error);
      wsClients.delete(ws);
    }
  }
});

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket endpoint: ws://localhost:${server.port}/stream`);
console.log(`🖥️  Terminal gateway (web): ws://localhost:${server.port}/terminal`);
console.log(`🤖 Terminal gateway (agent): ws://localhost:${server.port}/agent`);
console.log(`📮 POST events to: http://localhost:${server.port}/events`);