# AI Documentation Q&A - haiku45

## Fetch Results
- ✅ Success: https://docs.claude.com/en/docs/claude-code/sub-agents → ai_docs/haiku45/sub-agents.md
- ✅ Success: https://docs.claude.com/en/docs/claude-code/slash-commands → ai_docs/haiku45/slash-commands.md
- ✅ Success: https://docs.claude.com/en/docs/claude-code/skills → ai_docs/haiku45/skills.md
- ✅ Success: https://docs.claude.com/en/docs/claude-code/mcp → ai_docs/haiku45/mcp.md
- ✅ Success: https://docs.anthropic.com/en/docs/claude-code/hooks → ai_docs/haiku45/hooks.md
- ✅ Success: https://docs.claude.com/en/docs/claude-code/plugins → ai_docs/haiku45/plugins.md
- ✅ Success: https://blog.google/technology/google-deepmind/gemini-computer-use-model/ → ai_docs/haiku45/gemini-computer-use.md
- ✅ Success: https://developers.openai.com/blog/realtime-api → ai_docs/haiku45/openai-realtime-api.md
- ✅ Success: https://developers.openai.com/blog/responses-api → ai_docs/haiku45/openai-responses-api.md

## Question 1: Subagents Priority System

**What are the three different priority levels for subagents (project-level, user-level, CLI-defined), and how does the priority system determine which subagent is used when there are naming conflicts? Explain with a specific example scenario.**

Based on the documentation, Claude Code subagents have the following priority levels (from highest to lowest):

| Priority | Type | Location | Scope |
|----------|------|----------|-------|
| **Highest** | Project subagents | `.claude/agents/` | Current project only |
| **Lower** | User subagents | `~/.claude/agents/` | All projects for the user |
| **(Dynamic)** | CLI-defined | `--agents` flag | Current session only |

### Priority Resolution

When there are naming conflicts, **project-level subagents take precedence over user-level subagents**. This allows teams to override personal configurations with project-specific versions.

### Example Scenario

Consider a developer named Alex who has:

1. **User-level subagent** (`~/.claude/agents/code-reviewer.md`):
   ```yaml
   ---
   name: code-reviewer
   description: Personal code reviewer focusing on Python best practices
   tools: Read, Grep, Glob
   model: haiku
   ---
   Review code for Python style and PEP 8 compliance.
   ```

2. **Project-level subagent** (`.claude/agents/code-reviewer.md` in a React project):
   ```yaml
   ---
   name: code-reviewer
   description: Team code reviewer for React/TypeScript projects
   tools: Read, Grep, Glob, Bash
   model: sonnet
   ---
   Review React components for accessibility, performance, and TypeScript best practices.
   ```

**What happens when Alex runs `> Use the code-reviewer subagent to check my changes`:**

- Claude Code loads the **project-level** `code-reviewer` because it has **highest priority**
- The React/TypeScript-focused reviewer is used instead of the Python-focused one
- The project's tool set (including Bash) and model (Sonnet) are applied

This design ensures:
- **Team consistency**: All team members use the same project-specific subagent
- **Project customization**: Different projects can have tailored subagents with the same name
- **Personal fallbacks**: User-level subagents are still available in projects without overrides

## Question 2: Plugin Directory Structure

**Explain the complete directory structure required for a plugin that includes commands, agents, skills, hooks, and MCP servers. What is the purpose of the .claude-plugin directory and what files must it contain?**

### Complete Plugin Directory Structure

```
plugin-root/
├── .claude-plugin/
│   └── plugin.json          # REQUIRED - Plugin manifest
├── commands/                # Slash commands (Markdown files)
│   ├── hello.md
│   └── deploy.md
├── agents/                  # Agent/subagent definitions (Markdown files)
│   ├── code-reviewer.md
│   └── debugger.md
├── skills/                  # Agent Skills (SKILL.md files)
│   └── pdf-processing/
│       ├── SKILL.md
│       ├── reference.md
│       └── scripts/
│           └── helper.py
├── hooks/                   # Event handlers
│   └── hooks.json
├── .mcp.json               # MCP server configurations
└── .lsp.json               # LSP server configurations (optional)
```

### Purpose of `.claude-plugin/` Directory

The `.claude-plugin/` directory serves as the **identifier** that marks a directory as a Claude Code plugin. It contains:

1. **`plugin.json`** (REQUIRED) - The plugin manifest file

### plugin.json Structure

```json
{
  "name": "my-plugin",
  "description": "Description shown in plugin manager",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

**Key fields:**
- `name`: Unique identifier that becomes the command namespace (e.g., `/my-plugin:hello`)
- `description`: Shown in the plugin manager UI
- `version`: Semantic versioning for releases
- `author`: Optional attribution information

### Component Details

| Component | Location | Purpose |
|-----------|----------|---------|
| **plugin.json** | `.claude-plugin/plugin.json` | Required manifest - identifies the plugin |
| **Commands** | `commands/*.md` | User-invoked slash commands with `$ARGUMENTS` placeholders |
| **Agents** | `agents/*.md` | Subagent definitions with YAML frontmatter |
| **Skills** | `skills/*/SKILL.md` | Model-invoked capabilities with optional supporting files |
| **Hooks** | `hooks/hooks.json` | Event handlers (PreToolUse, PostToolUse, etc.) |
| **MCP Servers** | `.mcp.json` | Model Context Protocol server configurations |
| **LSP Servers** | `.lsp.json` | Language Server Protocol configurations |

### Important Notes

1. **Only `plugin.json` goes inside `.claude-plugin/`** - all other directories are at the plugin root level
2. Slash commands are namespaced: `hello.md` becomes `/plugin-name:hello`
3. Hooks use the same format as `settings.json` but in a dedicated `hooks.json` file
4. Skills automatically become available when the plugin is loaded

## Question 3: Skills vs Subagents

**How do Agent Skills differ from subagents in terms of invocation, context management, and when each should be used? Provide specific use cases where Skills are preferred over subagents and vice versa.**

### Key Differences

| Aspect | Agent Skills | Subagents |
|--------|--------------|-----------|
| **Invocation** | **Model-invoked** - Claude autonomously decides when to use them | **User-invoked** or **automatic delegation** based on task description |
| **Context** | Runs within the **main conversation context** | Operates in its **own separate context window** |
| **Scope** | Extends Claude's capabilities with instructions | Creates a specialized AI assistant with custom personality |
| **Tool Access** | Can restrict with `allowed-tools` | Can restrict with `tools` field |
| **Persistence** | Instructions remain in context | Context is isolated, preserving main conversation |

### Invocation Comparison

**Skills (Model-Invoked):**
```yaml
---
name: pdf-processing
description: Extract text from PDFs. Use when working with PDF files.
---
```
Claude automatically invokes this skill when a user mentions PDFs without explicit instruction.

**Subagents (User-Invoked or Auto-Delegated):**
```bash
> Use the code-reviewer subagent to check my changes
> Have the debugger investigate this error
```
Explicit invocation or Claude delegates based on task matching.

### Context Management

**Skills:**
- Instructions are loaded into the **current conversation**
- No context isolation - skill executions affect the main context
- Best for quick, focused operations

**Subagents:**
- Each subagent has its **own context window**
- Prevents "context pollution" of the main conversation
- Can be resumed later with `agentId` for continuity
- Better for long-running or multi-step tasks

### When to Use Skills (Preferred)

1. **Quick, repeatable patterns** - Generating commit messages, code formatting
   ```yaml
   name: generating-commit-messages
   description: Generates commit messages from git diffs. Use when writing commits.
   ```

2. **Domain-specific knowledge** - PDF processing, data analysis
   ```yaml
   name: excel-analysis
   description: Analyze Excel files. Use when working with spreadsheets or .xlsx files.
   ```

3. **Tool restrictions without context switch** - Read-only operations
   ```yaml
   name: safe-file-reader
   allowed-tools: Read, Grep, Glob
   ```

4. **Lightweight extensions** - When you want Claude to autonomously apply expertise

### When to Use Subagents (Preferred)

1. **Complex, multi-step investigations** - Debugging, root cause analysis
   ```yaml
   name: debugger
   description: Debugging specialist for errors and test failures. Use proactively when encountering issues.
   ```

2. **Specialized personas requiring isolation** - Code review, security audits
   ```yaml
   name: security-auditor
   description: Security expert for vulnerability assessment. Use after major changes.
   tools: Read, Grep, Glob, Bash
   ```

3. **Long-running research tasks** - Architecture planning, documentation
   - Can be resumed across sessions using `agentId`
   - Context preserved without polluting main conversation

4. **Chained workflows** - When multiple specialized agents need to collaborate
   ```bash
   > First use code-analyzer to find issues, then use optimizer to fix them
   ```

5. **Different model requirements** - Use Haiku for fast exploration, Sonnet for complex analysis
   ```yaml
   model: haiku  # Fast, low-latency operations
   ```

### Decision Matrix

| Scenario | Use Skill | Use Subagent |
|----------|-----------|--------------|
| Generate commit message | ✅ | |
| Deep code review | | ✅ |
| PDF text extraction | ✅ | |
| Debug complex test failure | | ✅ |
| Format code on save | ✅ | |
| Security vulnerability audit | | ✅ |
| Quick file search pattern | ✅ | |
| Multi-session research | | ✅ |
| Lightweight helper script | ✅ | |
| Specialized persona (reviewer, architect) | | ✅ |
