// New interface for human-in-the-loop requests
export interface HumanInTheLoop {
  question: string;
  responseWebSocketUrl: string;
  type: 'question' | 'permission' | 'choice' | 'approval' | 'question_input';
  choices?: string[]; // For multiple choice questions
  timeout?: number; // Optional timeout in seconds
  requiresResponse?: boolean; // Whether response is required or optional
  context?: Record<string, any>; // Additional context for approval (e.g., tool_name, command)
}

// Response interface
export interface HumanInTheLoopResponse {
  response?: string;
  permission?: boolean;
  choice?: string; // Selected choice from options
  approved?: boolean; // For 'approval' type - whether action was approved
  comment?: string; // Optional comment for approval/denial
  cancelled?: boolean; // For 'question_input' type - whether user cancelled
  hookEvent: HookEvent;
  respondedAt: number;
  respondedBy?: string; // Optional user identifier
}

// Status tracking interface
export interface HumanInTheLoopStatus {
  status: 'pending' | 'responded' | 'timeout' | 'error';
  respondedAt?: number;
  response?: HumanInTheLoopResponse;
}

export interface HookEvent {
  id?: number;
  source_app: string;
  session_id: string;
  hook_event_type: string;
  payload: Record<string, any>;
  chat?: any[];
  summary?: string;
  timestamp?: number;
  model_name?: string;
  project_id?: string;

  // NEW: Optional HITL data
  humanInTheLoop?: HumanInTheLoop;
  humanInTheLoopStatus?: HumanInTheLoopStatus;
}

// Lightweight event summary for list view (no payload/chat)
export interface EventSummary {
  id: number;
  source_app: string;
  session_id: string;
  hook_event_type: string;
  timestamp: number;
  model_name?: string;
  summary?: string;
  project_id?: string;
  // Extracted from payload for display:
  tool_name?: string;
  tool_command?: string;
  tool_file_path?: string;
  tool_description?: string;
  // HITL flags (lightweight):
  has_hitl: boolean;
  hitl_type?: string;
  hitl_status?: 'pending' | 'responded';
  // Optional full HITL data for real-time events (needed for HITL UI)
  humanInTheLoop?: HumanInTheLoop;
  humanInTheLoopStatus?: HumanInTheLoopStatus;
}

// Convert full HookEvent to lightweight EventSummary
export function toEventSummary(event: HookEvent): EventSummary {
  return {
    id: event.id!,
    source_app: event.source_app,
    session_id: event.session_id,
    hook_event_type: event.hook_event_type,
    timestamp: event.timestamp!,
    model_name: event.model_name,
    summary: event.summary,
    project_id: event.project_id,
    // Extract from payload
    tool_name: event.payload?.tool_name,
    tool_command: event.payload?.tool_input?.command,
    tool_file_path: event.payload?.tool_input?.file_path,
    tool_description: event.payload?.tool_input?.description,
    // HITL
    has_hitl: !!event.humanInTheLoop,
    hitl_type: event.humanInTheLoop?.type,
    hitl_status: event.humanInTheLoop ? (event.humanInTheLoopStatus ? 'responded' : 'pending') : undefined,
    // Keep full HITL for real-time events
    humanInTheLoop: event.humanInTheLoop,
    humanInTheLoopStatus: event.humanInTheLoopStatus
  };
}

// Time range filter types
export type TimeRange = 'live' | '1h' | '24h' | '7d' | '30d' | 'all' | 'custom';

export interface EventFilters {
  timeRange?: TimeRange;
  from?: number;        // timestamp ms
  to?: number;          // timestamp ms
  source_app?: string;
  session_id?: string;
  hook_event_type?: string;
  limit?: number;
  offset?: number;
}

export interface FilterOptions {
  source_apps: string[];
  session_ids: string[];
  hook_event_types: string[];
}

// Theme-related interfaces for server-side storage and API
export interface ThemeColors {
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryDark: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgQuaternary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textQuaternary: string;
  borderPrimary: string;
  borderSecondary: string;
  borderTertiary: string;
  accentSuccess: string;
  accentWarning: string;
  accentError: string;
  accentInfo: string;
  shadow: string;
  shadowLg: string;
  hoverBg: string;
  activeBg: string;
  focusRing: string;
}

export interface Theme {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  colors: ThemeColors;
  isPublic: boolean;
  authorId?: string;
  authorName?: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  downloadCount?: number;
  rating?: number;
  ratingCount?: number;
}

export interface ThemeSearchQuery {
  query?: string;
  tags?: string[];
  authorId?: string;
  isPublic?: boolean;
  sortBy?: 'name' | 'created' | 'updated' | 'downloads' | 'rating';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ThemeShare {
  id: string;
  themeId: string;
  shareToken: string;
  expiresAt?: number;
  isPublic: boolean;
  allowedUsers: string[];
  createdAt: number;
  accessCount: number;
}

export interface ThemeRating {
  id: string;
  themeId: string;
  userId: string;
  rating: number; // 1-5
  comment?: string;
  createdAt: number;
}

export interface ThemeValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  validationErrors?: ThemeValidationError[];
}

// Project Management interfaces
export interface Project {
  id: string;                    // group:project format
  displayName?: string;
  description?: string;
  gitRemoteUrl?: string;
  localPath?: string;
  createdAt: number;
  updatedAt: number;
  lastSessionId?: string;
  lastActivityAt?: number;
  status: 'active' | 'archived' | 'paused';
  metadata?: Record<string, unknown>;
  isManual?: boolean;            // true if manually created, false if auto-registered
  repositories?: Repository[];   // multi-repo support
}

export interface ProjectSession {
  id: string;                    // full session UUID
  projectId: string;
  startedAt: number;
  endedAt?: number;
  status: 'active' | 'completed' | 'abandoned';
  modelName?: string;
  eventCount: number;
  toolCallCount: number;
  notes?: string;
  // Session metadata for identification
  cwd?: string;                  // working directory
  transcriptPath?: string;       // path to transcript file
  permissionMode?: string;       // permission settings
  initialPrompt?: string;        // first user message/task
  summary?: string;              // session summary from Stop event
  gitBranch?: string;            // git branch if available
}

export interface ProjectSearchQuery {
  status?: 'active' | 'archived' | 'paused';
  query?: string;
  sortBy?: 'name' | 'created' | 'updated' | 'lastActivity';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// Project Settings Types
export type SettingType = 'skills' | 'agents' | 'commands' | 'permissions' | 'hooks' | 'output_styles';

export interface ProjectSetting {
  id: string;
  projectId: string;
  settingType: SettingType;
  settingKey: string;
  settingValue: Record<string, any>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSettingInput {
  settingKey: string;
  settingValue: Record<string, any>;
  enabled?: boolean;
}

// Specific setting value interfaces
export interface SkillSettingValue {
  name: string;
  description?: string;
  path?: string;
  allowedTools?: string[];
}

export interface AgentSettingValue {
  name: string;
  description: string;
  model: 'haiku' | 'sonnet' | 'opus';
  tools: string[];
  color?: string;
}

export interface CommandSettingValue {
  name: string;
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
}

export interface PermissionsSettingValue {
  protectedFiles?: string[];
  hitlEnabled?: boolean;
  hitlTypes?: Record<string, 'approval' | 'notify' | 'auto'>;
  timeouts?: Record<string, number>;
}

// Repository interface for multi-repo projects
export interface Repository {
  id: string;
  projectId: string;
  name: string;
  gitRemoteUrl?: string;
  localPath?: string;
  gitBranch?: string;
  isPrimary: boolean;
  createdAt: number;
}

export interface RepositoryInput {
  name: string;
  gitRemoteUrl?: string;
  localPath?: string;
  gitBranch?: string;
  isPrimary?: boolean;
}

// Session Settings with inheritance
export type OverrideMode = 'replace' | 'extend' | 'disable';

export interface SessionSetting {
  id: string;
  sessionId: string;
  settingType: SettingType;
  settingKey: string;
  settingValue: Record<string, any>;
  overrideMode: OverrideMode;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSettingInput {
  settingKey: string;
  settingValue: Record<string, any>;
  overrideMode?: OverrideMode;
  enabled?: boolean;
}