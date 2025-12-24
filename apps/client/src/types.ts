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
  model?: string;
  project_id?: string;

  // Tool information
  tool_name?: string;
  tool_command?: string;
  tool_file?: { path: string; [key: string]: any };

  // HITL information
  hitl_question?: string;
  hitl_permission?: string;

  // NEW: Optional HITL data
  humanInTheLoop?: HumanInTheLoop;
  humanInTheLoopStatus?: HumanInTheLoopStatus;
}

export interface FilterOptions {
  source_apps: string[];
  session_ids: string[];
  hook_event_types: string[];
}

export interface WebSocketMessage {
  type: 'initial' | 'event' | 'hitl_response';
  data: HookEvent | HookEvent[] | HumanInTheLoopResponse;
}

export type TimeRange = '1m' | '3m' | '5m' | '10m';

export interface ChartDataPoint {
  timestamp: number;
  count: number;
  eventTypes: Record<string, number>; // event type -> count
  sessions: Record<string, number>; // session id -> count
}

export interface ChartConfig {
  maxDataPoints: number;
  animationDuration: number;
  barWidth: number;
  barGap: number;
  colors: {
    primary: string;
    glow: string;
    axis: string;
    text: string;
  };
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

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ReassignSessionResult {
  session: ProjectSession;
  movedEvents: number;
}