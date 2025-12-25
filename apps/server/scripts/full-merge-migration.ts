#!/usr/bin/env bun
/**
 * Full Merge Migration Script
 *
 * Merges data from multiple sources into PostgreSQL:
 * 1. events.db (SQLite) - observability events
 * 2. history.jsonl files - Claude Code session history
 * 3. backup history.jsonl files - older sessions
 *
 * Usage:
 *   bun run scripts/full-merge-migration.ts [options]
 *
 * Options:
 *   --dry-run           Show what would be migrated without executing
 *   --skip-embeddings   Skip LanceDB embedding generation
 *   --batch <size>      Batch size for inserts (default: 100)
 */

import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import { parseArgs } from 'util';
import { createHash } from 'crypto';
import { EmbeddingQueue, extractSearchableContent } from '../src/vector';

// Parse CLI arguments
const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    'dry-run': { type: 'boolean', default: false },
    'skip-embeddings': { type: 'boolean', default: false },
    batch: { type: 'string', default: '100' },
    help: { type: 'boolean', short: 'h', default: false }
  }
});

if (args.help) {
  console.log(`
Full Merge Migration Script

Merges all Claude Code data sources into PostgreSQL + LanceDB:
- events.db: Hook events from observability
- history.jsonl: Current session history
- backup history.jsonl: Older sessions from backups

Usage:
  bun run scripts/full-merge-migration.ts [options]

Options:
  --dry-run           Show what would be migrated without executing
  --skip-embeddings   Skip LanceDB embedding generation
  --batch <size>      Batch size for inserts (default: 100)
  -h, --help          Show this help message
`);
  process.exit(0);
}

const DRY_RUN = args['dry-run'] || false;
const SKIP_EMBEDDINGS = args['skip-embeddings'] || false;
const BATCH_SIZE = parseInt(args.batch || '100');

const POSTGRES_URL = process.env.DATABASE_URL;
if (!POSTGRES_URL) {
  console.error('❌ DATABASE_URL required');
  process.exit(1);
}

// Data source paths
const HOME = process.env.HOME || '/home/snaiper';
const DATA_SOURCES = {
  eventsDb: `${HOME}/.claude/observability/data/events.db`,
  currentHistory: `${HOME}/.claude/history.jsonl`,
  backupHistory: `${HOME}/.claude-backup-20251114_060428/history.jsonl`,
  preRotationHistory: `${HOME}/.claude/history.jsonl.prerotation-backup`
};

// Progress bar helper
function progressBar(current: number, total: number, label: string): void {
  const width = 40;
  const percent = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  process.stdout.write(`\r${label}: [${bar}] ${percent}% (${current}/${total})`);
  if (current === total) console.log();
}

// Generate project_id from filesystem path
function pathToProjectId(path: string): string {
  // Normalize path and create a short deterministic ID
  const normalized = path.replace(/^\/home\/[^/]+\//, '~/').replace(/\/$/, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// Extract project name from path
function extractProjectName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'unknown';
}

interface HistoryEntry {
  display: string;
  pastedContents: Record<string, { id: number; type: string; content: string }>;
  timestamp: number;
  project: string;
  sessionId?: string;
}

// Parse history.jsonl file
async function parseHistoryFile(path: string): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  const file = Bun.file(path);

  if (!(await file.exists())) {
    console.log(`   ⚠️ File not found: ${path}`);
    return entries;
  }

  const text = await file.text();
  const lines = text.trim().split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (e) {
      // Skip malformed lines
    }
  }

  return entries;
}

// Main migration function
async function migrate() {
  console.log('🚀 Full Merge Migration: All Sources → PostgreSQL + LanceDB\n');
  console.log(`📂 Data Sources:`);
  console.log(`   events.db: ${DATA_SOURCES.eventsDb}`);
  console.log(`   current history: ${DATA_SOURCES.currentHistory}`);
  console.log(`   backup history: ${DATA_SOURCES.backupHistory}`);
  console.log(`   pre-rotation: ${DATA_SOURCES.preRotationHistory}`);
  console.log(`🐘 Postgres: ${POSTGRES_URL?.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`📦 Batch: ${BATCH_SIZE}`);
  console.log(`🔍 Embeddings: ${SKIP_EMBEDDINGS ? 'Skip' : 'Generate'}`);
  console.log(`🧪 Dry run: ${DRY_RUN}\n`);

  // === PHASE 1: Collect all data sources ===
  console.log('📊 Phase 1: Collecting data sources...\n');

  // 1a. SQLite events
  let sqliteEvents: any[] = [];
  let sqliteProjects: any[] = [];
  let sqliteSessions: any[] = [];

  if (await Bun.file(DATA_SOURCES.eventsDb).exists()) {
    const sqlite = new Database(DATA_SOURCES.eventsDb, { readonly: true });

    try {
      sqliteEvents = sqlite.query('SELECT * FROM events ORDER BY id').all() as any[];
      console.log(`   ✅ events.db: ${sqliteEvents.length} events`);
    } catch { console.log(`   ⚠️ events.db: no events table`); }

    try {
      sqliteProjects = sqlite.query('SELECT * FROM projects').all() as any[];
      console.log(`   ✅ events.db: ${sqliteProjects.length} projects`);
    } catch { console.log(`   ⚠️ events.db: no projects table`); }

    try {
      sqliteSessions = sqlite.query('SELECT * FROM project_sessions').all() as any[];
      console.log(`   ✅ events.db: ${sqliteSessions.length} sessions`);
    } catch { console.log(`   ⚠️ events.db: no sessions table`); }

    sqlite.close();
  } else {
    console.log(`   ⚠️ events.db not found`);
  }

  // 1b. History files
  const currentHistory = await parseHistoryFile(DATA_SOURCES.currentHistory);
  console.log(`   ✅ current history: ${currentHistory.length} entries`);

  const backupHistory = await parseHistoryFile(DATA_SOURCES.backupHistory);
  console.log(`   ✅ backup history: ${backupHistory.length} entries`);

  const preRotationHistory = await parseHistoryFile(DATA_SOURCES.preRotationHistory);
  console.log(`   ✅ pre-rotation: ${preRotationHistory.length} entries`);

  // Merge all history entries and deduplicate by timestamp
  const allHistory = [...backupHistory, ...preRotationHistory, ...currentHistory];
  const uniqueHistory = new Map<string, HistoryEntry>();
  for (const entry of allHistory) {
    const key = `${entry.timestamp}-${entry.project}`;
    if (!uniqueHistory.has(key)) {
      uniqueHistory.set(key, entry);
    }
  }
  const mergedHistory = Array.from(uniqueHistory.values());
  console.log(`   📊 Merged history: ${mergedHistory.length} unique entries (deduped from ${allHistory.length})`);

  // Summary
  const totalEvents = sqliteEvents.length;
  const totalHistory = mergedHistory.length;
  console.log(`\n📈 Total to migrate:`);
  console.log(`   Events from SQLite: ${totalEvents}`);
  console.log(`   History entries: ${totalHistory}`);
  console.log(`   Total records: ${totalEvents + totalHistory}\n`);

  if (DRY_RUN) {
    console.log('🧪 DRY RUN - no changes will be made');

    // Show sample history entry mapping
    if (mergedHistory.length > 0) {
      const sample = mergedHistory[0];
      console.log('\n📝 Sample history entry mapping:');
      console.log(`   timestamp: ${sample.timestamp} → ${new Date(sample.timestamp).toISOString()}`);
      console.log(`   project: ${sample.project} → id: ${pathToProjectId(sample.project)}`);
      console.log(`   sessionId: ${sample.sessionId || '(generated)'}`);
      console.log(`   display: ${sample.display.slice(0, 50)}...`);
    }
    return;
  }

  // === PHASE 2: Connect to PostgreSQL ===
  console.log('📊 Phase 2: Connecting to PostgreSQL...\n');
  const postgres = new SQL(POSTGRES_URL!);
  console.log('   ✅ Connected to PostgreSQL\n');

  // Initialize embedding queue if needed
  let embeddingQueue: EmbeddingQueue | null = null;
  if (!SKIP_EMBEDDINGS) {
    console.log('🔍 Initializing embedding queue...');
    embeddingQueue = new EmbeddingQueue();
    await embeddingQueue.init();
    console.log('   ✅ Embedding queue ready\n');
  }

  // === PHASE 3: Migrate projects ===
  console.log('📊 Phase 3: Migrating projects...\n');

  // Collect unique projects from all sources
  const projectsMap = new Map<string, { id: string; path: string; name: string }>();

  // From SQLite events
  for (const p of sqliteProjects) {
    projectsMap.set(p.id, { id: p.id, path: p.local_path || '', name: p.display_name || p.id });
  }

  // From history entries
  for (const h of mergedHistory) {
    const id = pathToProjectId(h.project);
    if (!projectsMap.has(id)) {
      projectsMap.set(id, { id, path: h.project, name: extractProjectName(h.project) });
    }
  }

  console.log(`   Found ${projectsMap.size} unique projects`);

  let projectCount = 0;
  for (const [id, project] of projectsMap) {
    await postgres`
      INSERT INTO projects (id, display_name, local_path, status, created_at, updated_at)
      VALUES (${id}, ${project.name}, ${project.path}, 'active', NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        local_path = COALESCE(EXCLUDED.local_path, projects.local_path),
        updated_at = NOW()
    `;
    projectCount++;
    progressBar(projectCount, projectsMap.size, 'Projects');
  }

  // === PHASE 4: Migrate SQLite events ===
  if (sqliteEvents.length > 0) {
    console.log('\n📊 Phase 4: Migrating SQLite events...\n');

    let eventCount = 0;
    for (let i = 0; i < sqliteEvents.length; i += BATCH_SIZE) {
      const batch = sqliteEvents.slice(i, i + BATCH_SIZE);

      for (const e of batch) {
        const result = await postgres`
          INSERT INTO events (source_app, session_id, project_id, hook_event_type, payload, chat, summary, timestamp, created_at)
          VALUES (
            ${e.source_app || 'claude-code'},
            ${e.session_id},
            ${e.project_id},
            ${e.hook_event_type || 'unknown'},
            ${e.payload || '{}'}::jsonb,
            ${e.chat}::jsonb,
            ${e.summary},
            ${e.timestamp ? new Date(e.timestamp) : new Date()},
            NOW()
          )
          RETURNING id
        `;

        // Queue for embedding
        if (embeddingQueue && result[0]?.id) {
          const event = {
            id: result[0].id,
            source_app: e.source_app,
            session_id: e.session_id,
            project_id: e.project_id,
            hook_event_type: e.hook_event_type,
            payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload,
            chat: e.chat ? (typeof e.chat === 'string' ? JSON.parse(e.chat) : e.chat) : undefined,
            summary: e.summary
          };
          const content = extractSearchableContent(event as any);
          if (content) {
            embeddingQueue.enqueue(result[0].id, e.session_id, e.project_id || 'unknown', content);
          }
        }

        eventCount++;
      }
      progressBar(eventCount, sqliteEvents.length, 'SQLite Events');
    }
  }

  // === PHASE 5: Migrate history entries ===
  console.log('\n📊 Phase 5: Migrating history entries...\n');

  let historyCount = 0;
  for (let i = 0; i < mergedHistory.length; i += BATCH_SIZE) {
    const batch = mergedHistory.slice(i, i + BATCH_SIZE);

    for (const h of batch) {
      const projectId = pathToProjectId(h.project);
      // Generate sessionId if missing (based on timestamp day + project)
      const sessionId = h.sessionId || createHash('sha256')
        .update(`${Math.floor(h.timestamp / 86400000)}-${h.project}`)
        .digest('hex')
        .slice(0, 36);

      // Build payload from display and pastedContents
      const payload = {
        type: 'history_entry',
        display: h.display,
        pastedContents: Object.keys(h.pastedContents || {}).length > 0 ? h.pastedContents : undefined
      };

      const result = await postgres`
        INSERT INTO events (source_app, session_id, project_id, hook_event_type, payload, timestamp, created_at)
        VALUES (
          'claude-code',
          ${sessionId},
          ${projectId},
          'user_prompt',
          ${JSON.stringify(payload)}::jsonb,
          ${new Date(h.timestamp)},
          NOW()
        )
        RETURNING id
      `;

      // Queue for embedding
      if (embeddingQueue && result[0]?.id) {
        const content = h.display + (h.pastedContents && Object.keys(h.pastedContents).length > 0
          ? '\n' + Object.values(h.pastedContents).map(p => p.content).join('\n').slice(0, 1000)
          : '');
        if (content.trim()) {
          embeddingQueue.enqueue(result[0].id, sessionId, projectId, content);
        }
      }

      historyCount++;
    }
    progressBar(historyCount, mergedHistory.length, 'History');
  }

  // === PHASE 6: Wait for embeddings ===
  if (embeddingQueue) {
    console.log('\n⏳ Waiting for embeddings to complete...');
    let stableCount = 0;

    while (true) {
      const stats = await embeddingQueue.getStats();
      progressBar(stats.processedCount, stats.processedCount + stats.queueLength, 'Embeddings');

      if (stats.queueLength === 0) {
        stableCount++;
        if (stableCount >= 3) break;
      } else {
        stableCount = 0;
      }

      await Bun.sleep(1000);
    }

    const finalStats = await embeddingQueue.getStats();
    console.log(`\n✅ Embeddings: ${finalStats.processedCount} processed, ${finalStats.failedCount} failed`);
    embeddingQueue.stop();
  }

  // === PHASE 7: Final counts ===
  console.log('\n🎉 Migration complete!\n');
  console.log('📊 Final PostgreSQL counts:');

  const eventCount = await postgres`SELECT COUNT(*) as c FROM events`;
  const projectCount2 = await postgres`SELECT COUNT(*) as c FROM projects`;
  console.log(`   events: ${eventCount[0]?.c || 0}`);
  console.log(`   projects: ${projectCount2[0]?.c || 0}`);
}

// Run migration
migrate().catch(err => {
  console.error('\n❌ Migration failed:', err);
  process.exit(1);
});
