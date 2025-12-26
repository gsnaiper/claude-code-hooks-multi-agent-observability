"""
Project Context Detection

Automatically detects project type, runtime, package manager,
frameworks, and other context to provide intelligent hints.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field


@dataclass
class ProjectContext:
    """Detected project context"""
    # Basic info
    root_dir: str = ""
    project_name: str = ""

    # Runtime & Package Manager
    runtime: str = "node"  # node, bun, deno, python, go, rust
    package_manager: str = "npm"  # npm, yarn, pnpm, bun, pip, cargo

    # Project type
    project_type: str = "unknown"  # frontend, backend, fullstack, library, cli

    # Frameworks detected
    frameworks: List[str] = field(default_factory=list)

    # Build tools
    build_tool: Optional[str] = None  # vite, webpack, esbuild, tsc

    # Test runner
    test_runner: Optional[str] = None  # jest, vitest, bun:test, pytest

    # Environment files
    env_files: List[str] = field(default_factory=list)

    # Custom hints from CLAUDE.md
    claude_hints: List[str] = field(default_factory=list)

    # Scripts from package.json
    available_scripts: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'root_dir': self.root_dir,
            'project_name': self.project_name,
            'runtime': self.runtime,
            'package_manager': self.package_manager,
            'project_type': self.project_type,
            'frameworks': self.frameworks,
            'build_tool': self.build_tool,
            'test_runner': self.test_runner,
            'env_files': self.env_files,
            'claude_hints': self.claude_hints,
            'available_scripts': self.available_scripts,
        }


def detect_project_context(cwd: Optional[str] = None) -> ProjectContext:
    """
    Detect project context from current working directory.

    Args:
        cwd: Working directory to analyze (defaults to os.getcwd())

    Returns:
        ProjectContext with detected settings
    """
    if cwd is None:
        cwd = os.getcwd()

    ctx = ProjectContext(root_dir=cwd)
    root = Path(cwd)

    # Detect from package.json
    pkg_json = root / 'package.json'
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            ctx.project_name = pkg.get('name', root.name)
            ctx.available_scripts = pkg.get('scripts', {})

            # Detect runtime
            deps = {**pkg.get('dependencies', {}), **pkg.get('devDependencies', {})}

            if 'bun-types' in deps or pkg.get('trustedDependencies'):
                ctx.runtime = 'bun'
                ctx.package_manager = 'bun'
            elif 'deno' in str(deps):
                ctx.runtime = 'deno'
                ctx.package_manager = 'deno'

            # Detect package manager from lockfiles
            if (root / 'bun.lockb').exists() or (root / 'bun.lock').exists():
                ctx.package_manager = 'bun'
                ctx.runtime = 'bun'
            elif (root / 'pnpm-lock.yaml').exists():
                ctx.package_manager = 'pnpm'
            elif (root / 'yarn.lock').exists():
                ctx.package_manager = 'yarn'
            elif (root / 'package-lock.json').exists():
                ctx.package_manager = 'npm'

            # Detect frameworks
            if 'vue' in deps:
                ctx.frameworks.append('vue')
            if 'react' in deps:
                ctx.frameworks.append('react')
            if 'svelte' in deps:
                ctx.frameworks.append('svelte')
            if 'express' in deps:
                ctx.frameworks.append('express')
            if 'fastify' in deps:
                ctx.frameworks.append('fastify')
            if 'hono' in deps:
                ctx.frameworks.append('hono')
            if 'next' in deps:
                ctx.frameworks.append('next')
            if 'nuxt' in deps:
                ctx.frameworks.append('nuxt')

            # Detect build tools
            if 'vite' in deps:
                ctx.build_tool = 'vite'
            elif 'webpack' in deps:
                ctx.build_tool = 'webpack'
            elif 'esbuild' in deps:
                ctx.build_tool = 'esbuild'
            elif 'tsup' in deps:
                ctx.build_tool = 'tsup'

            # Detect test runner
            if 'vitest' in deps:
                ctx.test_runner = 'vitest'
            elif 'jest' in deps:
                ctx.test_runner = 'jest'
            elif ctx.runtime == 'bun':
                ctx.test_runner = 'bun:test'

            # Detect project type
            if 'vue' in deps or 'react' in deps or 'svelte' in deps:
                if 'express' in deps or 'fastify' in deps or 'hono' in deps:
                    ctx.project_type = 'fullstack'
                else:
                    ctx.project_type = 'frontend'
            elif 'express' in deps or 'fastify' in deps or 'hono' in deps:
                ctx.project_type = 'backend'
            elif pkg.get('bin'):
                ctx.project_type = 'cli'
            elif pkg.get('main') or pkg.get('module'):
                ctx.project_type = 'library'

        except (json.JSONDecodeError, IOError):
            pass

    # Detect Python projects
    if (root / 'pyproject.toml').exists() or (root / 'setup.py').exists():
        ctx.runtime = 'python'
        if (root / 'poetry.lock').exists():
            ctx.package_manager = 'poetry'
        elif (root / 'Pipfile.lock').exists():
            ctx.package_manager = 'pipenv'
        elif (root / 'uv.lock').exists():
            ctx.package_manager = 'uv'
        else:
            ctx.package_manager = 'pip'

        if (root / 'pytest.ini').exists() or (root / 'conftest.py').exists():
            ctx.test_runner = 'pytest'

    # Detect Go projects
    if (root / 'go.mod').exists():
        ctx.runtime = 'go'
        ctx.package_manager = 'go'

    # Detect Rust projects
    if (root / 'Cargo.toml').exists():
        ctx.runtime = 'rust'
        ctx.package_manager = 'cargo'

    # Find environment files
    env_patterns = ['.env', '.env.local', '.env.development', '.env.production']
    for pattern in env_patterns:
        env_file = root / pattern
        if env_file.exists():
            ctx.env_files.append(str(env_file))

    # Parse CLAUDE.md for hints
    claude_md = root / 'CLAUDE.md'
    if claude_md.exists():
        try:
            content = claude_md.read_text()
            # Extract key hints (lines starting with - in CLAUDE.md)
            for line in content.split('\n'):
                line = line.strip()
                if line.startswith('- Use `') or line.startswith('- Prefer '):
                    ctx.claude_hints.append(line[2:])  # Remove "- "
        except IOError:
            pass

    return ctx


def get_command_substitutions(ctx: ProjectContext) -> Dict[str, str]:
    """
    Get command substitutions based on project context.

    Returns dict mapping old commands to new commands.
    """
    subs = {}

    if ctx.runtime == 'bun':
        # Bun substitutions
        subs['npm run'] = 'bun run'
        subs['npm install'] = 'bun install'
        subs['npm test'] = 'bun test'
        subs['npx '] = 'bunx '
        subs['yarn '] = 'bun '
        subs['pnpm '] = 'bun '
        subs['node '] = 'bun '
        subs['ts-node '] = 'bun '
        subs['jest'] = 'bun test'
        subs['vitest'] = 'bun test'
    elif ctx.package_manager == 'pnpm':
        subs['npm run'] = 'pnpm run'
        subs['npm install'] = 'pnpm install'
        subs['npx '] = 'pnpm dlx '
    elif ctx.package_manager == 'yarn':
        subs['npm run'] = 'yarn'
        subs['npm install'] = 'yarn'
        subs['npx '] = 'yarn dlx '

    if ctx.runtime == 'python':
        if ctx.package_manager == 'poetry':
            subs['pip install'] = 'poetry add'
            subs['python -m pytest'] = 'poetry run pytest'
        elif ctx.package_manager == 'uv':
            subs['pip install'] = 'uv add'
            subs['python '] = 'uv run python '

    return subs


def apply_substitutions(command: str, ctx: ProjectContext) -> Optional[str]:
    """
    Apply command substitutions based on project context.

    Returns modified command or None if no changes needed.
    """
    subs = get_command_substitutions(ctx)
    original = command

    for old, new in subs.items():
        if old in command:
            command = command.replace(old, new)

    if command != original:
        return command
    return None
