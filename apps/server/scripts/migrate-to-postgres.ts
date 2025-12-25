#!/usr/bin/env bun
/**
 * Migration Script: SQLite to PostgreSQL + LanceDB
 *
 * Migrates all data from SQLite database to PostgreSQL,
 * optionally generating embeddings for LanceDB semantic search.
 *
 * Usage:
 *   bun run scripts/migrate-to-postgres.ts [options]
 *
 * Options:
 *   --sqlite <path>     SQLite database path (default: events.db)
 *   --postgres <url>    PostgreSQL connection URL (default: from DATABASE_URL)
 *   --batch <size>      Batch size for inserts (default: 100)
 *   --skip-embeddings   Skip LanceDB embedding generation
 *   --embeddings-only   Only generate embeddings (skip data migration)
 *   --dry-run           Show what would be migrated without executing
 */

import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import { parseArgs } from 'util';
import { EmbeddingQueue, extractSearchableContent } from '../src/vector';

// Parse CLI arguments
const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    sqlite: { type: 'string', default: 'events.db' },
    postgres: { type: 'string', default: process.env.DATABASE_URL },
    batch: { type: 'string', default: '100' },
    'skip-embeddings': { type: 'boolean', default: false },
    'embeddings-only': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (args.help) {
  console.log(`
Migration Script: SQLite to PostgreSQL + LanceDB

Usage:
  bun run scripts/migrate-to-postgres.ts [options]

Options:
  --sqlite <path>     SQLite database path (default: events.db)
  --postgres <url>    PostgreSQL connection URL (default: from DATABASE_URL)
  --batch <size>      Batch size for inserts (default: 100)
  --skip-embeddings   Skip LanceDB embedding generation
  --embeddings-only   Only generate embeddings (skip data migration)
  --dry-run           Show what would be migrated without executing
  -h, --help          Show this help message
`);
  process.exit(0);
}

const BATCH_SIZE = parseInt(args.batch || '100');
const SQLITE_PATH = args.sqlite || 'events.db';
const POSTGRES_URL = args.postgres || process.env.DATABASE_URL;
const SKIP_EMBEDDINGS = args['skip-embeddings'] || false;
const EMBEDDINGS_ONLY = args['embeddings-only'] || false;
const DRY_RUN = args['dry-run'] || false;

if (!POSTGRES_URL) {
  console.error('❌ PostgreSQL URL required. Set DATABASE_URL or use --postgres');
  process.exit(1);
}

// Progress bar helper
function progressBar(current: number, total: number, label: string): void {
  const width = 40;
  const percent = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  process.stdout.write(`\r${label}: [${bar}] ${percent}% (${current}/${total})`);
  if (current === total) console.log();
}

// Main migration function
async function migrate() {
  console.log('🚀 Migration Script: SQLite → PostgreSQL + LanceDB\n');
  console.log(`📂 SQLite:   ${SQLITE_PATH}`);
  console.log(`🐘 Postgres: ${POSTGRES_URL?.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`📦 Batch:    ${BATCH_SIZE}`);
  console.log(`🔍 Embeddings: ${SKIP_EMBEDDINGS ? 'Skip' : 'Generate'}`);
  console.log(`🧪 Dry run:  ${DRY_RUN}\n`);

  // Connect to SQLite
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  console.log('✅ Connected to SQLite\n');

  // Get table counts
  const tables = ['events', 'projects', 'project_sessions', 'themes', 'audio_cache'];
  const counts: Record<string, number> = {};

  console.log('📊 Source data:');
  for (const table of tables) {
    try {
      const result = sqlite.query(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
      counts[table] = result.c;
      console.log(`   ${table}: ${result.c} rows`);
    } catch {
      counts[table] = 0;
      console.log(`   ${table}: (not found)`);
    }
  }
  console.log();

  if (DRY_RUN) {
    console.log('🧪 DRY RUN - no changes will be made');
    sqlite.close();
    return;
  }

  // Connect to PostgreSQL
  const postgres = new SQL(POSTGRES_URL!);
  console.log('✅ Connected to PostgreSQL\n');

  // Initialize embedding queue if needed
  let embeddingQueue: EmbeddingQueue | null = null;
  if (!SKIP_EMBEDDINGS) {
    console.log('🔍 Initializing embedding queue...');
    embeddingQueue = new EmbeddingQueue();
    await embeddingQueue.init();
    console.log('✅ Embedding queue ready\n');
  }

  if (!EMBEDDINGS_ONLY) {
    // Migrate projects first (foreign key dependency)
    if (counts.projects > 0) {
      console.log('📦 Migrating projects...');
      const projects = sqlite.query('SELECT * FROM projects').all();

      for (let i = 0; i < projects.length; i += BATCH_SIZE) {
        const batch = projects.slice(i, i + BATCH_SIZE);
        for (const p of batch as any[]) {
          await postgres`
            INSERT INTO projects (id, display_name, description, git_remote_url, local_path, status, metadata, last_session_id, last_activity_at, created_at, updated_at)
            VALUES (${p.id}, ${p.display_name}, ${p.description}, ${p.git_remote_url}, ${p.local_path}, ${p.status || 'active'}, ${p.metadata}::jsonb, ${p.last_session_id}, ${p.last_activity_at ? new Date(p.last_activity_at) : null}, ${p.created_at ? new Date(p.created_at) : new Date()}, ${p.updated_at ? new Date(p.updated_at) : new Date()})
            ON CONFLICT (id) DO UPDATE SET
              display_name = EXCLUDED.display_name,
              last_activity_at = EXCLUDED.last_activity_at,
              updated_at = NOW()
          `;
        }
        progressBar(Math.min(i + BATCH_SIZE, projects.length), projects.length, 'Projects');
      }
    }

    // Migrate project_sessions
    if (counts.project_sessions > 0) {
      console.log('📦 Migrating sessions...');
      const sessions = sqlite.query('SELECT * FROM project_sessions').all();

      for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
        const batch = sessions.slice(i, i + BATCH_SIZE);
        for (const s of batch as any[]) {
          await postgres`
            INSERT INTO project_sessions (id, project_id, model_name, started_at, event_count, tool_call_count)
            VALUES (${s.id}, ${s.project_id}, ${s.model_name}, ${s.started_at ? new Date(s.started_at) : new Date()}, ${s.event_count || 0}, ${s.tool_call_count || 0})
            ON CONFLICT (id) DO UPDATE SET
              event_count = EXCLUDED.event_count,
              tool_call_count = EXCLUDED.tool_call_count
          `;
        }
        progressBar(Math.min(i + BATCH_SIZE, sessions.length), sessions.length, 'Sessions');
      }
    }

    // Migrate events (main data)
    if (counts.events > 0) {
      console.log('📦 Migrating events...');
      const eventCount = counts.events;
      let migrated = 0;

      // Stream events in batches to avoid memory issues
      const stmt = sqlite.query('SELECT * FROM events ORDER BY id LIMIT ? OFFSET ?');

      for (let offset = 0; offset < eventCount; offset += BATCH_SIZE) {
        const batch = stmt.all(BATCH_SIZE, offset) as any[];

        for (const e of batch) {
          const result = await postgres`
            INSERT INTO events (source_app, session_id, project_id, hook_event_type, payload, chat, summary, human_in_the_loop, human_in_the_loop_status, timestamp)
            VALUES (${e.source_app}, ${e.session_id}, ${e.project_id}, ${e.hook_event_type}, ${e.payload}::jsonb, ${e.chat}::jsonb, ${e.summary}, ${e.human_in_the_loop}::jsonb, ${e.human_in_the_loop_status}::jsonb, ${e.timestamp ? new Date(e.timestamp) : new Date()})
            RETURNING id
          `;

          // Queue for embedding if enabled
          if (embeddingQueue && result[0]?.id) {
            const event = {
              id: result[0].id,
              source_app: e.source_app,
              session_id: e.session_id,
              project_id: e.project_id,
              hook_event_type: e.hook_event_type,
              payload: JSON.parse(e.payload || '{}'),
              chat: e.chat ? JSON.parse(e.chat) : undefined,
              summary: e.summary
            };
            const content = extractSearchableContent(event as any);
            if (content) {
              embeddingQueue.enqueue(result[0].id, e.session_id, e.project_id || 'unknown', content);
            }
          }

          migrated++;
        }

        progressBar(migrated, eventCount, 'Events');
      }
    }

    // Migrate audio_cache
    if (counts.audio_cache > 0) {
      console.log('📦 Migrating audio cache...');
      const audioCache = sqlite.query('SELECT * FROM audio_cache').all();

      for (let i = 0; i < audioCache.length; i += BATCH_SIZE) {
        const batch = audioCache.slice(i, i + BATCH_SIZE);
        for (const a of batch as any[]) {
          const id = a.id || crypto.randomUUID();
          await postgres`
            INSERT INTO audio_cache (id, key, audio_data, mime_type, voice_id, text_hash, source_app, size_bytes, created_at, accessed_at, access_count)
            VALUES (${id}, ${a.key}, ${a.audio_data}, ${a.mime_type || 'audio/mpeg'}, ${a.voice_id}, ${a.text_hash}, ${a.source_app}, ${a.size_bytes || 0}, ${a.created_at ? new Date(a.created_at) : new Date()}, ${a.accessed_at ? new Date(a.accessed_at) : new Date()}, ${a.access_count || 1})
            ON CONFLICT (key) DO NOTHING
          `;
        }
        progressBar(Math.min(i + BATCH_SIZE, audioCache.length), audioCache.length, 'Audio');
      }
    }

    // Migrate themes (if any)
    if (counts.themes > 0) {
      console.log('📦 Migrating themes...');
      const themes = sqlite.query('SELECT * FROM themes').all();

      for (let i = 0; i < themes.length; i += BATCH_SIZE) {
        const batch = themes.slice(i, i + BATCH_SIZE);
        for (const t of batch as any[]) {
          // Parse tags - SQLite stores as JSON string, Postgres expects TEXT[]
          let tags: string[] | null = null;
          if (t.tags) {
            try {
              tags = typeof t.tags === 'string' ? JSON.parse(t.tags) : t.tags;
            } catch { tags = null; }
          }

          await postgres`
            INSERT INTO themes (id, name, display_name, colors, is_public, author_id, author_name, description, tags, download_count, created_at, updated_at)
            VALUES (${t.id}, ${t.name}, ${t.display_name}, ${t.colors}::jsonb, ${t.is_public || false}, ${t.author_id}, ${t.author_name}, ${t.description}, ${tags}, ${t.download_count || 0}, ${t.created_at ? new Date(t.created_at) : new Date()}, ${t.updated_at ? new Date(t.updated_at) : new Date()})
            ON CONFLICT (id) DO NOTHING
          `;
        }
        progressBar(Math.min(i + BATCH_SIZE, themes.length), themes.length, 'Themes');
      }
    }
  }

  // Wait for embeddings to complete
  if (embeddingQueue) {
    console.log('\n⏳ Waiting for embeddings to complete...');
    let lastCount = 0;
    let stableIterations = 0;

    while (true) {
      const stats = await embeddingQueue.getStats();
      progressBar(stats.processedCount, stats.processedCount + stats.queueLength, 'Embeddings');

      if (stats.queueLength === 0) {
        stableIterations++;
        if (stableIterations >= 3) break; // Wait 3 iterations with empty queue
      } else {
        stableIterations = 0;
      }

      if (stats.processedCount === lastCount && stats.queueLength === 0) break;
      lastCount = stats.processedCount;

      await Bun.sleep(1000);
    }

    const finalStats = await embeddingQueue.getStats();
    console.log(`\n✅ Embeddings: ${finalStats.processedCount} processed, ${finalStats.failedCount} failed`);

    embeddingQueue.stop();
  }

  // Close connections
  sqlite.close();
  console.log('\n🎉 Migration complete!\n');

  // Show final counts
  console.log('📊 PostgreSQL data:');
  const pgTables = ['events', 'projects', 'project_sessions', 'themes', 'audio_cache'];
  for (const table of pgTables) {
    try {
      const result = await postgres`SELECT COUNT(*) as c FROM ${postgres(table)}`;
      console.log(`   ${table}: ${result[0]?.c || 0} rows`);
    } catch {
      console.log(`   ${table}: (error)`);
    }
  }
}

// Run migration
migrate().catch(err => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
