---
name: version-bump
description: Manage semantic version updates for this project. Handles patch, minor, and major version increments following semantic versioning. Updates package.json, marketplace.json, and plugin.json. Creates git tags and GitHub releases. Auto-generates CHANGELOG.md from releases.
---

# Version Bump Skill

## Your Tasks

IMPORTANT: ultrathink for every task

1. **Decide version type** (only if user doesn't specify):
   - **PATCH** (x.y.Z): Bug fixes only
   - **MINOR** (x.Y.0): New features, backward compatible
   - **MAJOR** (X.0.0): Breaking changes

2. **Write detailed release notes** describing the changes

## Workflow

```bash
# 1. Check current version
${CLAUDE_PLUGIN_ROOT}/scripts/version-bump.sh check

# 2. Decide new version (PATCH/MINOR/MAJOR)

# 3. Update version files
${CLAUDE_PLUGIN_ROOT}/scripts/version-bump.sh update X.Y.Z

# 4. Write release notes, then release (pipe notes via stdin)
cat <<'EOF' | ${CLAUDE_PLUGIN_ROOT}/scripts/version-bump.sh release X.Y.Z
## What's New
- Feature 1
- Feature 2

## Bug Fixes
- Fix 1
EOF
```

## Checklist

- [ ] Ultrathink + decide version type
- [ ] Write detailed release notes
- [ ] Run update script
- [ ] Run release script (with notes piped via stdin)
