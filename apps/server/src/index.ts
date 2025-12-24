import {
  initDatabase,
  insertEvent,
  getFilterOptions,
  getRecentEvents,
  getEventsBySessionId,
  updateEventHITLResponse,
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
  backfillSessionMetadata
} from './db';
import type { HookEvent, HumanInTheLoopResponse, Project, ProjectSearchQuery, SettingType, ProjectSettingInput } from './types';
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

// Helper function to send response to agent via WebSocket
async function sendResponseToAgent(
  wsUrl: string,
  response: HumanInTheLoopResponse
): Promise<void> {
  console.log(`[HITL] Connecting to agent WebSocket: ${wsUrl}`);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isResolved = false;

    const cleanup = () => {
      if (ws) {
        try {
          ws.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    };

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

        // Broadcast to all WebSocket clients
        const message = JSON.stringify({ type: 'event', data: savedEvent });
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

    // GET /events/recent - Get recent events
    if (url.pathname === '/events/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '300');
      const events = await getRecentEvents(limit);
      return new Response(JSON.stringify(events), {
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

        // Broadcast updated event to all connected clients
        const message = JSON.stringify({ type: 'event', data: updatedEvent });
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
    if (url.pathname.match(/^\/api\/sessions\/[^\/]+$/) && req.method === 'GET') {
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

    // Default response
    return new Response('Multi-Agent Observability Server', {
      headers: { ...headers, 'Content-Type': 'text/plain' }
    });
  },
  
  websocket: {
    async open(ws) {
      console.log('WebSocket client connected');
      wsClients.add(ws);

      // Send recent events on connection
      const events = await getRecentEvents(300);
      ws.send(JSON.stringify({ type: 'initial', data: events }));
    },
    
    message(ws, message) {
      // Handle any client messages if needed
      console.log('Received message:', message);
    },
    
    close(ws) {
      console.log('WebSocket client disconnected');
      wsClients.delete(ws);
    },
    
    error(ws, error) {
      console.error('WebSocket error:', error);
      wsClients.delete(ws);
    }
  }
});

console.log(`🚀 Server running on http://localhost:${server.port}`);
console.log(`📊 WebSocket endpoint: ws://localhost:${server.port}/stream`);
console.log(`📮 POST events to: http://localhost:${server.port}/events`);