# Human-in-the-Loop (HITL) Documentation

## Overview

The Human-in-the-Loop (HITL) system provides a mechanism for Claude Code hooks to request user input, approval, or permission before executing certain operations. This enables interactive workflows where critical decisions or sensitive operations require explicit human approval.

### Why HITL?

- **Safety**: Prevent dangerous or destructive operations without explicit approval
- **Interactivity**: Allow Claude to ask questions and get real-time user input
- **Flexibility**: Redirect Claude's built-in questions to a centralized UI with voice/text input
- **Auditability**: Track all approval requests and responses in the observability dashboard

## Architecture

```
┌─────────────┐
│ Claude Hook │ (pre_tool_use.py)
└──────┬──────┘
       │ 1. Create HITL request
       ↓
┌─────────────────────────┐
│ Observability Server    │
│ POST /events            │
│ - Validates request     │
│ - Stores in PostgreSQL  │
│ - Sets timeout timer    │
└──────┬──────────────────┘
       │ 2. Broadcast via WebSocket
       ↓
┌─────────────────────────┐
│ Dashboard UI            │
│ - Shows HITL request    │
│ - Plays audio alert     │
│ - Accepts voice/text    │
└──────┬──────────────────┘
       │ 3. Submit response
       ↓
┌─────────────────────────┐
│ POST /events/:id/respond│
│ - Update database       │
│ - Try WebSocket delivery│
│ - Store for polling     │
└──────┬──────────────────┘
       │ 4a. WebSocket (if available)
       ↓
┌─────────────┐            ┌──────────────────┐
│ Hook (agent)│ ←─────────→│ Polling fallback │
│ - Receives  │    4b.     │ GET /events/:id/ │
│   response  │            │     response     │
│ - Continues │            │ - Exponential    │
│   execution │            │   backoff        │
└─────────────┘            └──────────────────┘

Database (PostgreSQL):
┌────────────────────────────────────┐
│ events table                       │
│ - humanInTheLoop (JSONB)           │
│ - humanInTheLoopStatus (JSONB)     │
│   - status: pending/responded      │
│   - response: user's answer        │
└────────────────────────────────────┘
```

## HITL Types

The system supports five types of HITL interactions:

### 1. `question_input`
**Purpose**: Redirect Claude's AskUserQuestion to the observability UI

**Use Case**: When Claude wants to ask the user a question, intercept it and display in the dashboard with voice/text input support.

**Example**:
```python
from utils.hitl import ask_question_via_hitl

result = ask_question_via_hitl(
    "Which database should I use for this project?",
    session_data,
    context={"options": ["PostgreSQL", "MySQL", "MongoDB"]},
    payload=original_payload
)

if result.answered:
    print(f"User answered: {result.response}")
elif result.cancelled:
    sys.exit(2)  # Block the tool
```

### 2. `approval`
**Purpose**: Request approval for file edits, writes, or command execution

**Use Case**: Protected files or dangerous operations need explicit approval before proceeding.

**Example**:
```python
from utils.hitl import ask_approval

result = ask_approval(
    "Allow editing .env file?",
    session_data,
    context={"tool_name": "Edit", "file_path": "/path/.env"},
    payload=original_payload
)

if result.approved:
    print(f"Approved! Comment: {result.comment}")
    sys.exit(0)  # Allow
else:
    print(f"Denied. Reason: {result.comment}")
    sys.exit(2)  # Block
```

### 3. `permission`
**Purpose**: Request yes/no permission for an operation

**Use Case**: Simple binary decisions (allow/deny).

**Example**:
```python
from utils.hitl import ask_permission

allowed = ask_permission(
    "Allow rm -rf command?",
    session_data,
    timeout=120
)

if allowed:
    sys.exit(0)  # Allow
else:
    sys.exit(2)  # Block
```

### 4. `choice`
**Purpose**: Ask user to choose from a list of options

**Use Case**: Multiple-choice decisions.

**Example**:
```python
from utils.hitl import ask_choice

choice = ask_choice(
    "Select deployment environment:",
    ["dev", "staging", "production"],
    session_data
)

if choice:
    print(f"User selected: {choice}")
```

### 5. `question`
**Purpose**: Ask a free-form question and get text response

**Use Case**: General questions requiring text input.

**Example**:
```python
from utils.hitl import ask_question

answer = ask_question(
    "What is the API endpoint URL?",
    session_data,
    timeout=300
)

if answer:
    print(f"User provided: {answer}")
```

## API Endpoints

### POST /events
Create a new event with HITL request.

**Request Body**:
```typescript
{
  source_app: string;
  session_id: string;
  hook_event_type: string;
  payload: object;
  humanInTheLoop: {
    type: 'question' | 'question_input' | 'approval' | 'permission' | 'choice';
    question: string;
    responseWebSocketUrl: string;  // e.g., "ws://localhost:12345"
    timeout?: number;               // Default: 300 seconds
    requiresResponse?: boolean;     // Default: true
    choices?: string[];             // For type='choice'
    context?: {                     // For type='approval' or 'question_input'
      tool_name?: string;
      file_path?: string;
      command?: string;
      // ... additional fields
    };
  };
}
```

**Response**:
```typescript
{
  id: number;                      // Event ID
  // ... full event object
}
```

### POST /events/:id/respond
Submit a user response to a HITL request.

**Request Body**:
```typescript
{
  respondedBy?: string;            // User identifier (optional)

  // For type='question' or 'question_input':
  response?: string;               // Text answer
  cancelled?: boolean;             // User cancelled (question_input only)

  // For type='permission':
  permission?: boolean;            // true = allow, false = deny

  // For type='choice':
  choice?: string;                 // Selected option

  // For type='approval':
  approved?: boolean;              // true = approve, false = deny
  comment?: string;                // Optional voice/text comment
}
```

**Response**:
```typescript
{
  success: true;
  event: HookEvent;                // Updated event
  idempotencyKey: string;          // UUID for deduplication
  deliveryStatus: 'delivered' | 'pending_poll' | 'no_websocket';
  message: string;
}
```

**HTTP Status Codes**:
- `200 OK`: Response accepted and stored
- `404 Not Found`: Event not found
- `400 Bad Request`: Invalid request body

### GET /events/:id/response
Poll for a HITL response (fallback when WebSocket delivery fails).

**Query Parameters**: None

**Response (when answered)**:
```typescript
{
  success: true;
  data: {
    idempotencyKey: string;
    respondedAt: number;
    respondedBy?: string;
    // ... response fields based on HITL type
  }
}
```

**Response (no response yet)**:
```typescript
{
  success: false;
  error: "No response yet";
  status: "pending" | "timeout";
}
```

**HTTP Status Codes**:
- `200 OK`: Response is available
- `202 Accepted`: No response yet (with `Retry-After: 2` header)
- `404 Not Found`: Event not found
- `400 Bad Request`: Not a HITL event

## Data Schemas

### HumanInTheLoop (Request)

```typescript
interface HumanInTheLoop {
  // Type of interaction
  type: 'question' | 'question_input' | 'approval' | 'permission' | 'choice';

  // Question or prompt to display
  question: string;

  // WebSocket URL for direct response delivery
  responseWebSocketUrl: string;

  // Timeout in seconds (default: 300 for questions, 120 for approval)
  timeout?: number;

  // Whether a response is required (default: true)
  requiresResponse?: boolean;

  // For type='choice': available options
  choices?: string[];

  // Additional context for approval/question_input
  context?: {
    // Tool context
    tool_name?: string;
    command?: string;
    file_path?: string;

    // Edit tool context
    old_string?: string;
    new_string?: string;

    // Write tool context
    content?: string;

    // Question input context
    questions?: Array<{
      question?: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>;

    // Allow additional fields
    [key: string]: any;
  };
}
```

### HumanInTheLoopStatus

```typescript
interface HumanInTheLoopStatus {
  // Current status
  status: 'pending' | 'responded' | 'timeout' | 'error';

  // Timestamp when response was received
  respondedAt?: number;

  // Timeout timestamp (for status='timeout')
  timeoutAt?: number;

  // Error message (for status='error')
  errorMessage?: string;

  // The user's response
  response?: HumanInTheLoopResponse;
}
```

### HumanInTheLoopResponse

```typescript
interface HumanInTheLoopResponse {
  // Event ID this response is for
  eventId: number;

  // Deduplication key (UUID)
  idempotencyKey: string;

  // Timestamp when user responded
  respondedAt: number;

  // User identifier (optional)
  respondedBy?: string;

  // Response fields (depends on HITL type)
  response?: string;      // For 'question' and 'question_input'
  permission?: boolean;   // For 'permission'
  choice?: string;        // For 'choice'
  approved?: boolean;     // For 'approval'
  comment?: string;       // Optional comment for 'approval'
  cancelled?: boolean;    // For 'question_input' when user cancels
}
```

## Polling Configuration

The hook-side HITL client uses exponential backoff for polling when WebSocket delivery fails:

```python
# From hooks/utils/hitl.py
def _poll_for_response(event_id: int):
    attempt = 0
    max_retries = 300
    max_interval = 10.0  # seconds

    while attempt < max_retries and not_timed_out:
        try:
            response = GET(f"{server_url}/events/{event_id}/response")
            if response.status == 200:
                return response.data
        except HTTPError as e:
            if e.code in (404, 202):
                # No response yet, continue polling
                pass
            elif e.code == 429:
                # Rate limited, use longer backoff
                sleep(min(30, 5 * (2 ** min(attempt, 4))))
                continue
            else:
                # Fatal error
                return None

        # Exponential backoff with jitter: 1s, 2s, 4s, 8s, max 10s
        backoff = min(max_interval, (2 ** min(attempt, 4)) + random(0, 0.5))
        sleep(backoff)
        attempt += 1

    return None  # Timeout
```

**Backoff Schedule**:
- Attempt 1: 1s + jitter
- Attempt 2: 2s + jitter
- Attempt 3: 4s + jitter
- Attempt 4: 8s + jitter
- Attempt 5+: 10s + jitter (max)

**HTTP Status Handling**:
- `200 OK`: Response received, return data
- `202 Accepted` / `404 Not Found`: No response yet, continue polling
- `429 Too Many Requests`: Rate limited, use extended backoff (5-30s)
- `400 Bad Request` / `403 Forbidden` / `405 Method Not Allowed`: Fatal error, stop polling

## Configuration

### HITL Configuration (hooks/config.py)

```python
HITL_CONFIG = {
    # Master switch
    'enabled': True,

    # Tools that always require HITL
    'decision_tools': [
        'AskUserQuestion',   # Redirect questions to UI
        'ExitPlanMode',      # Plan execution approval
        'EnterPlanMode',     # Plan mode entry
    ],

    # File patterns requiring approval for Edit/Write
    'protected_file_patterns': [
        '*.env*',
        '**/package.json',
        '**/settings.json',
        '**/*.config.*',
        '**/CLAUDE.md',
        '.claude/**',
        '**/docker-compose*.yml',
        '**/Dockerfile*',
        '**/.gitlab-ci.yml',
        '**/.github/**',
    ],

    # Timeouts (in seconds)
    'timeouts': {
        'AskUserQuestion': 300,  # 5 minutes
        'ExitPlanMode': 120,     # 2 minutes
        'EnterPlanMode': 60,     # 1 minute
        'Edit': 120,
        'Write': 120,
        'default': 120,
    },

    # HITL types per tool
    'hitl_types': {
        'AskUserQuestion': 'question_input',
        'ExitPlanMode': 'approval',
        'EnterPlanMode': 'approval',
        'Edit': 'approval',
        'Write': 'approval',
    },
}
```

### Helper Functions (hooks/config.py)

```python
def is_hitl_enabled() -> bool:
    """Check if HITL is globally enabled"""
    return HITL_CONFIG.get('enabled', True)

def is_decision_tool(tool_name: str) -> bool:
    """Check if tool always requires HITL"""
    return tool_name in HITL_CONFIG['decision_tools']

def is_protected_file(file_path: str) -> bool:
    """Check if file matches protected patterns"""
    # Uses fnmatch with path normalization to prevent bypass

def get_timeout(tool_name: str) -> int:
    """Get timeout for specific tool"""
    return HITL_CONFIG['timeouts'].get(tool_name, 120)

def get_hitl_type(tool_name: str) -> str:
    """Get HITL type for tool"""
    return HITL_CONFIG['hitl_types'].get(tool_name, 'approval')

def should_require_hitl(tool_name: str, tool_input: dict) -> bool:
    """Determine if tool call requires HITL"""
    # Decision tools always require HITL
    # Edit/Write on protected files require HITL
```

## Workflow Examples

### Example 1: Intercept Claude's Question

**Hook**: `pre_tool_use.py` (AskUserQuestion)

```python
#!/usr/bin/env python3
import sys
import json
from utils.hitl import ask_question_via_hitl

# Read hook payload
payload = json.loads(sys.stdin.read())
session_data = {
    "source_app": "claude-code",
    "session_id": payload.get("session_id")
}

# Extract question from tool input
question = payload["tool_input"].get("question", "")

# Redirect to HITL UI
result = ask_question_via_hitl(
    question,
    session_data,
    hook_event_type="PreToolUse",
    payload=payload,
    timeout=300
)

if result.answered:
    # Inject answer back to Claude
    modified_payload = {
        **payload,
        "tool_input": {
            **payload["tool_input"],
            "answer": result.response
        }
    }
    print(json.dumps(modified_payload))
    sys.exit(0)
elif result.cancelled:
    # User cancelled
    sys.exit(2)
else:
    # Timeout - let Claude handle it
    sys.exit(0)
```

### Example 2: Protect Sensitive Files

**Hook**: `pre_tool_use.py` (Edit/Write)

```python
#!/usr/bin/env python3
import sys
import json
from config import is_protected_file, get_timeout
from utils.hitl import ask_approval

payload = json.loads(sys.stdin.read())
tool_name = payload["tool_name"]
file_path = payload["tool_input"].get("file_path", "")

if not is_protected_file(file_path):
    # Not protected, allow
    sys.exit(0)

# Protected file - require approval
session_data = {
    "source_app": "claude-code",
    "session_id": payload.get("session_id")
}

result = ask_approval(
    f"Allow {tool_name} on protected file: {file_path}?",
    session_data,
    context={
        "tool_name": tool_name,
        "file_path": file_path,
        "old_string": payload["tool_input"].get("old_string"),
        "new_string": payload["tool_input"].get("new_string")
    },
    timeout=get_timeout(tool_name),
    payload=payload
)

if result.approved:
    print(f"Approved: {result.comment}", file=sys.stderr)
    sys.exit(0)
else:
    print(f"Denied: {result.comment}", file=sys.stderr)
    sys.exit(2)
```

### Example 3: Dangerous Command Approval

**Hook**: `pre_tool_use.py` (Bash)

```python
#!/usr/bin/env python3
import sys
import json
import re
from utils.hitl import ask_permission

payload = json.loads(sys.stdin.read())
command = payload["tool_input"].get("command", "")

# Check for dangerous patterns
DANGEROUS_PATTERNS = [
    r'\brm\s+-rf?\s+/',
    r'\bdd\s+if=',
    r'\bmkfs\.',
    r'\b:\(\)\{.*:\|:.*\};:',  # Fork bomb
]

is_dangerous = any(re.search(pattern, command) for pattern in DANGEROUS_PATTERNS)

if not is_dangerous:
    sys.exit(0)

# Dangerous command - require permission
session_data = {
    "source_app": "claude-code",
    "session_id": payload.get("session_id")
}

allowed = ask_permission(
    f"Allow dangerous command: {command}?",
    session_data,
    timeout=120
)

sys.exit(0 if allowed else 2)
```

## Troubleshooting

### Issue: No response received (timeout)

**Symptoms**: Hook times out after waiting for response

**Possible Causes**:
1. Observability server is not running
2. Network connectivity issues
3. User didn't respond in time
4. WebSocket URL is incorrect

**Solutions**:
```bash
# Check server is running
curl http://localhost:4000/health

# Check event was created
curl http://localhost:4000/events/summaries | jq '.data[-1]'

# Check HITL status
curl http://localhost:4000/events/{ID} | jq '.data.humanInTheLoopStatus'

# Increase timeout
# In config.py:
HITL_CONFIG['timeouts']['default'] = 600  # 10 minutes
```

### Issue: 404 errors when polling

**Symptoms**: Hook receives 404 when polling `/events/:id/response`

**Possible Causes**:
1. Event ID is incorrect
2. Event was not created successfully
3. Server database issue

**Solutions**:
```bash
# Verify event ID from server logs
grep "HITL event" /var/log/observability-server.log

# Check database
psql -d observability -c "SELECT id, humanInTheLoop FROM events WHERE humanInTheLoop IS NOT NULL ORDER BY id DESC LIMIT 5;"

# Enable debug logging in hook
export HITL_DEBUG=true
```

### Issue: WebSocket delivery fails, polling doesn't work

**Symptoms**: Server shows "Failed to send response to agent", polling returns 404

**Possible Causes**:
1. WebSocket URL is localhost but hook is remote
2. Firewall blocking WebSocket connections
3. Agent crashed before receiving response

**Solutions**:
```python
# In hitl.py, ensure WebSocket URL is accessible
# Use public IP instead of localhost for remote hooks:
def get_observability_url():
    return os.environ.get('OBSERVABILITY_SERVER_URL', 'http://PUBLIC_IP:4000')

# Or rely entirely on polling by setting a short WebSocket timeout:
# In config.py
HITL_CONFIG['ws_timeout'] = 5  # Fail fast and use polling
```

### Issue: Response duplicated or idempotency issues

**Symptoms**: Hook receives same response multiple times

**Possible Causes**:
1. Multiple hooks polling simultaneously
2. WebSocket + polling both delivering

**Solutions**:
```python
# Check idempotencyKey in response
response = poll_for_response(event_id)
if response:
    key = response['idempotencyKey']
    # Store key and deduplicate
    if key not in seen_keys:
        seen_keys.add(key)
        process_response(response)
```

### Issue: Timeout too short for voice input

**Symptoms**: Users typing/speaking but timeout expires

**Solutions**:
```python
# Increase timeout for question_input type
HITL_CONFIG['timeouts']['AskUserQuestion'] = 600  # 10 minutes

# Or per-request:
result = ask_question_via_hitl(
    question,
    session_data,
    timeout=600  # 10 minutes
)
```

### Issue: Protected file patterns not matching

**Symptoms**: Files that should be protected are not triggering HITL

**Possible Causes**:
1. Pattern syntax incorrect
2. Path normalization bypassing pattern
3. Pattern too specific

**Solutions**:
```python
# Test pattern matching
from config import is_protected_file

test_paths = [
    "/project/.env",
    "/project/config/.env.local",
    "/project/package.json",
    "/project/nested/docker-compose.yml"
]

for path in test_paths:
    print(f"{path}: {is_protected_file(path)}")

# Add more permissive patterns
HITL_CONFIG['protected_file_patterns'] = [
    '**/.env*',      # Match anywhere
    '*.env*',        # Match in any directory
    # ...
]
```

## Best Practices

1. **Set appropriate timeouts**: Questions need longer timeouts (5-10 min), approvals shorter (1-2 min)

2. **Provide context**: Include tool name, file paths, commands in the context field for better UX

3. **Use voice input**: Enable voice comments for approval requests for hands-free workflow

4. **Handle cancellations**: Check `result.cancelled` for question_input type

5. **Fail-safe defaults**: On timeout, deny dangerous operations (exit 2), allow safe ones (exit 0)

6. **Test polling fallback**: Don't rely solely on WebSocket delivery

7. **Use idempotency keys**: Deduplicate responses when using both WebSocket and polling

8. **Monitor metrics**: Check `hitlService.getMetrics()` for delivery success rates

9. **Graceful degradation**: If server is down, allow operation with warning or deny with clear error

10. **Clear questions**: Make HITL questions specific and actionable for users

## Metrics and Monitoring

The HITL service tracks the following metrics:

```typescript
interface HITLMetrics {
  totalRequests: number;        // Total HITL requests created
  totalResponses: number;       // Total responses received
  totalTimeouts: number;        // Requests that timed out
  totalErrors: number;          // Errors during processing
  avgResponseTimeMs: number;    // Average time to respond
  pendingRequests: number;      // Currently pending requests
  deliveredCount: number;       // Successfully delivered via WebSocket
  failedDeliveryCount: number;  // Failed WebSocket deliveries
  pendingPollCount: number;     // Responses pending polling
}
```

Access metrics:
```bash
# Via API (future endpoint)
curl http://localhost:4000/api/hitl/metrics

# Via server console
# The hitlService.getMetrics() is logged on shutdown
```

## Security Considerations

1. **WebSocket URL validation**: Server validates WebSocket URLs are from localhost/whitelisted IPs
2. **Path normalization**: File paths are normalized to prevent `../../.env` bypass attacks
3. **Input validation**: All tool inputs are validated before processing
4. **Timeout enforcement**: Server enforces maximum timeouts to prevent resource exhaustion
5. **Rate limiting**: Polling endpoint can be rate-limited (HTTP 429)
6. **Idempotency**: Deduplication prevents double-processing of responses
7. **Access control**: Only events with valid session IDs can be responded to

## Future Enhancements

- Multi-user approval workflows (require N of M approvals)
- Approval templates and saved responses
- Integration with external auth systems (LDAP, OAuth)
- Approval delegation (route to on-call engineer)
- Audit logging for compliance
- Approval policies as code (YAML/JSON configuration)
- Mobile push notifications for HITL requests
- Slack/Teams integration for approval workflows
