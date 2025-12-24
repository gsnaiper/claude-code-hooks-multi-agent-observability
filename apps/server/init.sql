-- PostgreSQL Schema for Multi-Agent Observability
-- Optimized for high-volume event ingestion and efficient querying

-- ============================================
-- PROJECTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  description TEXT,
  git_remote_url TEXT,
  local_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_session_id TEXT,
  last_activity_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'paused')),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_last_activity ON projects(last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_projects_metadata ON projects USING GIN(metadata);

-- ============================================
-- PROJECT SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS project_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  model_name TEXT,
  event_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON project_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON project_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON project_sessions(status);

-- ============================================
-- EVENTS TABLE (Core hook events)
-- ============================================
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  source_app TEXT NOT NULL,
  session_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  hook_event_type TEXT NOT NULL,
  model_name TEXT,
  payload JSONB NOT NULL,
  chat JSONB,
  summary TEXT,
  human_in_the_loop JSONB,
  human_in_the_loop_status JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optimized indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_source_app ON events(source_app);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_project_id ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_hook_event_type ON events(hook_event_type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);

-- GIN indexes for JSONB columns to enable fast queries
CREATE INDEX IF NOT EXISTS idx_events_payload ON events USING GIN(payload);
CREATE INDEX IF NOT EXISTS idx_events_chat ON events USING GIN(chat);

-- Partial index for HITL pending events only (saves space)
CREATE INDEX IF NOT EXISTS idx_events_hitl_pending ON events(timestamp)
  WHERE human_in_the_loop IS NOT NULL
  AND human_in_the_loop_status->>'status' = 'pending';

-- ============================================
-- THEMES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  colors JSONB NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  author_id TEXT,
  author_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags TEXT[],
  download_count INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_themes_name ON themes(name);
CREATE INDEX IF NOT EXISTS idx_themes_is_public ON themes(is_public);
CREATE INDEX IF NOT EXISTS idx_themes_created_at ON themes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_themes_tags ON themes USING GIN(tags);

-- ============================================
-- THEME SHARES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS theme_shares (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  is_public BOOLEAN NOT NULL DEFAULT false,
  allowed_users TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_theme_shares_token ON theme_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_theme_shares_theme_id ON theme_shares(theme_id);

-- ============================================
-- THEME RATINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS theme_ratings (
  id TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(theme_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_theme_ratings_theme ON theme_ratings(theme_id);

-- ============================================
-- AUDIO CACHE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audio_cache (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  audio_data TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  voice_id TEXT,
  text_hash TEXT,
  source_app TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count INTEGER DEFAULT 1,
  size_bytes BIGINT
);

CREATE INDEX IF NOT EXISTS idx_audio_cache_key ON audio_cache(key);
CREATE INDEX IF NOT EXISTS idx_audio_cache_source_app ON audio_cache(source_app);
CREATE INDEX IF NOT EXISTS idx_audio_cache_accessed_at ON audio_cache(accessed_at);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for projects table
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger for themes table
DROP TRIGGER IF EXISTS update_themes_updated_at ON themes;
CREATE TRIGGER update_themes_updated_at
  BEFORE UPDATE ON themes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- MATERIALIZED VIEW (optional, for dashboard stats)
-- ============================================
-- Uncomment if needed for performance
-- CREATE MATERIALIZED VIEW IF NOT EXISTS session_stats AS
-- SELECT
--   ps.project_id,
--   COUNT(*) as total_sessions,
--   SUM(ps.event_count) as total_events,
--   SUM(ps.tool_call_count) as total_tool_calls,
--   MAX(ps.started_at) as last_session_start
-- FROM project_sessions ps
-- GROUP BY ps.project_id;
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_session_stats_project ON session_stats(project_id);
