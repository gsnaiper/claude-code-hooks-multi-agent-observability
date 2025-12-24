# Code Review: HITL Voice Input & Pre-hooks Extension

**Review Date:** 2025-12-23
**Reviewer:** Claude Opus 4.5
**Overall Rating:** 6.5/10

---

## Executive Summary

This review covers the implementation of:
1. **Voice Input (STT)** - Speech-to-text using ElevenLabs API
2. **Extended HITL for Pre-hooks** - Approval workflows for decision tools and protected files

### Files Reviewed

| File | Type | Status | Rating |
|------|------|--------|--------|
| `.claude/hooks/config.py` | Python | NEW | 7/10 |
| `.claude/hooks/pre_tool_use.py` | Python | Modified | 6/10 |
| `.claude/hooks/utils/hitl.py` | Python | Modified | 7/10 |
| `apps/client/src/types.ts` | TypeScript | Modified | 8/10 |
| `apps/server/src/types.ts` | TypeScript | Modified | 8/10 |
| `apps/client/src/components/EventRow.vue` | Vue | Modified | 7/10 |
| `apps/client/src/composables/useVoiceInput.ts` | TypeScript | Modified | 6.5/10 |
| `apps/client/src/composables/useAudioCache.ts` | TypeScript | Modified | 6/10 |
| `apps/client/src/composables/useSpeechToText.ts` | TypeScript | NEW | 5/10 |

---

## Critical Issues

### 1. Security: Shell Command Parsing (HIGH)
**File:** `pre_tool_use.py:35-75`

```python
path_pattern = r'rm\s+(?:-[\w]+\s+|--[\w-]+\s+)*(.+)$'
paths = path_str.split()  # Breaks with quoted paths
```

**Problem:** Regex-based command parsing is brittle and vulnerable to:
- Quoted paths: `rm -rf "/path with spaces"` breaks on split()
- Shell escapes: `rm -rf path\ with\ backslash`
- Command injection: `--option=$SHELL rm -rf /`

**Fix:** Use `shlex.split()` for proper shell parsing:
```python
import shlex
try:
    parts = shlex.split(command)
except ValueError:
    return False  # Malformed command
```

### 2. Security: Path Traversal (HIGH)
**File:** `config.py:67-78`

```python
if fnmatch.fnmatch(file_path, pattern):
    return True
```

**Problem:** No path normalization. `../../.env` could bypass protection.

**Fix:**
```python
from pathlib import Path
normalized = str(Path(file_path).resolve())
```

### 3. Error Masking (HIGH)
**File:** `pre_tool_use.py:380-385`

```python
except Exception:
    sys.exit(0)  # Silently succeeds on ANY error
```

**Problem:** All errors result in exit code 0 (allow), masking failures.

**Fix:** Log errors and exit with appropriate codes:
```python
except Exception as e:
    print(f"[HITL] Error: {e}", file=sys.stderr)
    sys.exit(0)  # Still allow, but logged
```

### 4. Type Unsafe Metadata (MEDIUM)
**File:** `useVoiceInput.ts:64, 97`

```typescript
(mediaRecorder as any)._lang = lang;  // Bypasses type safety
```

**Fix:** Use a separate ref for language:
```typescript
const recordingLanguage = ref<string>('ru-RU');
```

### 5. Missing Timeouts (MEDIUM)
**File:** `useAudioCache.ts:365-393`

```typescript
const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', ...);
// No timeout - could hang indefinitely
```

**Fix:**
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
try {
    const response = await fetch(url, { signal: controller.signal });
} finally {
    clearTimeout(timeout);
}
```

---

## Medium Priority Issues

### 6. Duplicate Composables
**Files:** `useSpeechToText.ts` vs `useVoiceInput.ts`

Both provide similar STT functionality. `useVoiceInput.ts` has better cleanup with `onUnmounted`. Consider consolidating.

### 7. No Audio Size Validation
**File:** `useVoiceInput.ts:58-60`

No limit on recording size. Could fail with large recordings.

```typescript
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB
if (currentSize > MAX_AUDIO_SIZE) {
    mediaRecorder?.stop();
    error.value = 'Recording too long';
}
```

### 8. TOCTOU Race Condition
**File:** `pre_tool_use.py:354-376`

```python
if log_path.exists():
    with open(log_path, 'r') as f:
        log_data = json.load(f)
# Race condition between check and write
```

**Fix:** Use file locking with `fcntl`.

### 9. Hardcoded Filename
**File:** `useAudioCache.ts:372`

```typescript
formData.append('file', audioBlob, 'recording.webm');  // Always .webm
```

Should derive extension from actual MIME type.

### 10. No JSON Schema Validation
**File:** `pre_tool_use.py:175-186`

Tool input is not validated. Consider using Pydantic:
```python
from pydantic import BaseModel
class ToolInput(BaseModel):
    tool_name: str
    tool_input: dict
```

---

## Low Priority Issues

| Issue | File | Line | Description |
|-------|------|------|-------------|
| Missing return types | `useSpeechToText.ts` | 14 | No explicit return type annotation |
| Generic error messages | `useVoiceInput.ts` | 74 | "Microphone access denied" - no error distinction |
| Hardcoded localhost | `hitl.py` | 44 | Should be configurable for containers |
| Missing onerror handler | `useSpeechToText.ts` | - | MediaRecorder.onerror not implemented |
| Cross-platform paths | `config.py` | 53 | Uses `/` split, breaks on Windows |

---

## Positive Highlights

1. **Well-structured HITL system** - Clear separation of concerns
2. **Excellent type hints in hitl.py** - Comprehensive annotations with docstrings
3. **Good Vue 3 composable patterns** - Proper reactive state management
4. **API key load balancing** - `getBestApiKey()` implementation
5. **Proper resource cleanup** - `onUnmounted` in useVoiceInput.ts

---

## Recommendations

### Immediate Actions
1. Replace regex command parsing with `shlex.split()`
2. Add path normalization in `is_protected_file()`
3. Add fetch timeouts with AbortController
4. Remove `as any` type casts in useVoiceInput.ts

### Short-term Improvements
1. Consolidate `useSpeechToText.ts` into `useVoiceInput.ts`
2. Add audio size/duration limits
3. Implement proper error logging in pre_tool_use.py
4. Add file locking for concurrent log access

### Long-term Considerations
1. Add Pydantic schema validation for hook inputs
2. Create test suite for command parsing edge cases
3. Consider proxying API calls through backend (security)
4. Add rate limiting for transcription requests

---

## Test Coverage Gaps

Missing tests for:
- Shell-escaped paths (spaces, quotes)
- Concurrent logging scenarios
- Malformed JSON input handling
- Windows path separators
- Command injection attempts
- API timeout scenarios

---

## Conclusion

The implementation provides functional HITL and voice input capabilities but requires security hardening before production use. The main concerns are:

1. **Shell command parsing** - vulnerable to edge cases
2. **Path validation** - missing normalization
3. **Error handling** - silent failures mask issues
4. **Type safety** - some unsafe casts remain

After addressing the critical and medium priority issues, the system will be production-ready.
