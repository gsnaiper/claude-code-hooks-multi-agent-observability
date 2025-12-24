import {
  initDatabase,
  insertEvent,
  getFilterOptions,
  getRecentEvents,
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
  incrementSessionCounts
} from './db';
import type { HookEvent, HumanInTheLoopResponse, Project, ProjectSearchQuery } from './types';
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

// Initialize database
initDatabase();

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
      'http://cli.di4.dev'
    ];

    // Handle CORS with dynamic origin
    const origin = req.headers.get('origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

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
        const project = ensureProjectExists(projectId);
        const session = ensureSessionExists(projectId, event.session_id, event.model_name);

        // Add project_id to event
        const eventWithProject = { ...event, project_id: projectId };

        // Insert event into database
        const savedEvent = insertEvent(eventWithProject);

        // Update counts and activity
        const isToolCall = event.hook_event_type.includes('ToolUse');
        incrementSessionCounts(session.id, 1, isToolCall ? 1 : 0);
        updateProjectActivity(projectId, event.session_id);
        
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
      const options = getFilterOptions();
      return new Response(JSON.stringify(options), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
    
    // GET /events/recent - Get recent events
    if (url.pathname === '/events/recent' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '300');
      const events = getRecentEvents(limit);
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
        const updatedEvent = updateEventHITLResponse(id, response);

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
        const existing = getAudioCacheByKey(key);
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

        const entry = insertAudioCache({
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

      const entry = getAudioCacheByKey(key);

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
      const stats = getAudioCacheStats();
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
      const deleted = deleteOldAudioCache(days * 24 * 60 * 60 * 1000);
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

      const projects = listProjects(query);
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

      const project = getProject(id);
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
        const existing = getProject(body.id);
        if (existing) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Project already exists'
          }), {
            status: 409,
            headers: { ...headers, 'Content-Type': 'application/json' }
          });
        }

        const project = insertProject({
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
        const project = updateProject(id, updates);

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

      const success = archiveProject(id);
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

      const project = getProject(id);
      if (!project) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Project not found'
        }), {
          status: 404,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }

      const sessions = listProjectSessions(id);
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

      const session = getSession(id);
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
    open(ws) {
      console.log('WebSocket client connected');
      wsClients.add(ws);
      
      // Send recent events on connection
      const events = getRecentEvents(300);
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