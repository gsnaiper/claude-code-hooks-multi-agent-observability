#!/usr/bin/env python3
"""
Project ID Generation Utility

Generates unique project identifiers using a 3-tier fallback:
1. Manual override: .claude/project-id file
2. Git remote: owner:repo format
3. Fallback: hashed directory path
"""

import os
import subprocess
import hashlib
from pathlib import Path
from typing import Optional


def get_project_id(cwd: Optional[str] = None) -> str:
    """
    Generate unique project ID using 3-tier fallback.

    Args:
        cwd: Current working directory (project root). Defaults to os.getcwd()

    Returns:
        Unique project identifier string
    """
    if cwd is None:
        cwd = os.getcwd()

    # Tier 1: Check for manual override
    project_id = _get_from_override_file(cwd)
    if project_id:
        return project_id

    # Tier 2: Extract from git remote URL
    project_id = _get_from_git_remote(cwd)
    if project_id:
        return project_id

    # Tier 3: Fallback to directory path hash
    return _get_from_directory_hash(cwd)


def _get_from_override_file(cwd: str) -> Optional[str]:
    """Check for .claude/project-id manual override file."""
    project_id_file = Path(cwd) / ".claude" / "project-id"
    if project_id_file.exists():
        project_id = project_id_file.read_text().strip()
        if project_id:
            return project_id
    return None


def _get_from_git_remote(cwd: str) -> Optional[str]:
    """Extract project ID from git remote URL."""
    try:
        result = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode != 0:
            return None

        git_remote = result.stdout.strip()
        if not git_remote:
            return None

        return _parse_git_url(git_remote)

    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None


def _parse_git_url(url: str) -> Optional[str]:
    """
    Parse various git URL formats to extract owner:repo.

    Supported formats:
    - https://github.com/owner/repo.git
    - https://github.com/owner/repo
    - git@github.com:owner/repo.git
    - ssh://git@github.com/owner/repo.git
    - https://gitlab.com/owner/repo.git
    """
    # Remove .git suffix
    url = url.removesuffix(".git")

    # Handle SSH format: git@github.com:owner/repo
    if url.startswith("git@"):
        # git@github.com:owner/repo -> owner/repo
        parts = url.split(":")
        if len(parts) == 2:
            path_parts = parts[1].split("/")
            if len(path_parts) >= 2:
                owner = path_parts[-2]
                repo = path_parts[-1]
                return f"{owner}:{repo}"

    # Handle HTTPS/SSH URL format
    # https://github.com/owner/repo -> owner/repo
    # ssh://git@github.com/owner/repo -> owner/repo
    parts = url.split("/")
    if len(parts) >= 2:
        owner = parts[-2]
        repo = parts[-1]

        # Clean up owner if it contains @ (ssh://git@github.com)
        if "@" in owner:
            owner = owner.split("@")[-1]

        # Validate we got reasonable values
        if owner and repo and not owner.startswith("http"):
            return f"{owner}:{repo}"

    return None


def _get_from_directory_hash(cwd: str) -> str:
    """Generate project ID from directory path hash."""
    abs_path = Path(cwd).resolve()

    # Create hash of full path for uniqueness
    path_hash = hashlib.sha256(str(abs_path).encode()).hexdigest()[:12]

    # Use directory name for readability
    dir_name = abs_path.name

    # Sanitize directory name (remove special chars)
    dir_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in dir_name)
    dir_name = dir_name[:30]  # Limit length

    return f"local:{dir_name}-{path_hash}"


def display_project_id(project_id: str, max_hash_len: int = 8) -> str:
    """
    Format project ID for display (truncate hash if present).

    Examples:
        "owner:repo" -> "owner:repo"
        "local:myproject-abc123def456" -> "local:myproject-abc123de"
    """
    if project_id.startswith("local:") and "-" in project_id:
        prefix, hash_part = project_id.rsplit("-", 1)
        if len(hash_part) > max_hash_len:
            return f"{prefix}-{hash_part[:max_hash_len]}"
    return project_id


# CLI interface for testing
if __name__ == "__main__":
    import sys

    cwd = sys.argv[1] if len(sys.argv) > 1 else None
    project_id = get_project_id(cwd)

    print(f"Project ID: {project_id}")
    print(f"Display ID: {display_project_id(project_id)}")
