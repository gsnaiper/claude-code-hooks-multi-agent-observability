---
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch, Task
description: Generate operational runbooks for systems, services, or procedures
argument-hint: [topic-or-system]
model: sonnet
---

# Runbook Generator

Generate comprehensive operational runbooks for systems, services, or procedures. This prompt analyzes the specified topic, gathers relevant context from the codebase and documentation, then produces a detailed runbook following the `Instructions` section.

## Variables

TOPIC: $1
OUTPUT_DIR: docs/runbooks
RUNBOOK_TEMPLATE: standard

## Workflow

1. **Analyze the topic**: Parse the `TOPIC` to understand what system, service, or procedure needs documentation
2. **Gather context**: Search the codebase for relevant files, configurations, scripts, and existing documentation related to `TOPIC`
3. **Identify components**: List all services, dependencies, configuration files, and scripts involved
4. **Research prerequisites**: Determine required access, credentials, tools, and permissions
5. **Document procedures**: Create step-by-step procedures for common operations (start, stop, restart, deploy, rollback)
6. **Add troubleshooting**: Include common issues, error messages, and resolution steps
7. **Define monitoring**: Document health checks, metrics, alerts, and dashboards
8. **Create the runbook**: Write the complete runbook to `OUTPUT_DIR/<topic-slug>.md`

## Report

After completing the runbook, provide a summary including:

### Runbook Created
- **File**: Path to the generated runbook
- **Topic**: The system/service/procedure documented
- **Sections**: List of main sections included

### Key Information Discovered
- Services and components identified
- Configuration files referenced
- Scripts and commands documented
- Dependencies mapped

### Recommendations
- Gaps in documentation that should be addressed
- Additional runbooks that may be needed
- Automation opportunities identified

### Usage
```bash
# To view the runbook
cat <runbook-path>

# To update the runbook
/runbook <topic>
```
