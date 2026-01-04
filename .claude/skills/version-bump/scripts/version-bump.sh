#!/bin/bash
# Version bump automation script
# Usage: version-bump.sh <command> [args]

set -e
cd "$(dirname "$0")/../../../.."

COMMAND="$1"
shift || true

case "$COMMAND" in
  check)
    echo "Current versions:"
    grep '"version"' server/package.json .claude-plugin/marketplace.json .claude-plugin/plugin.json
    ;;

  update)
    VERSION="$1"
    if [ -z "$VERSION" ]; then
      echo "Usage: version-bump.sh update <version>"
      exit 1
    fi
    if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Error: Version must be in format X.Y.Z"
      exit 1
    fi
    echo "Updating version to $VERSION..."
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" server/package.json
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" .claude-plugin/marketplace.json
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" .claude-plugin/plugin.json

    echo "Verifying versions..."
    V1=$(grep -o '"version": "[^"]*"' server/package.json | head -1 | cut -d'"' -f4)
    V2=$(grep -o '"version": "[^"]*"' .claude-plugin/marketplace.json | head -1 | cut -d'"' -f4)
    V3=$(grep -o '"version": "[^"]*"' .claude-plugin/plugin.json | head -1 | cut -d'"' -f4)

    ERROR=0
    if [ "$V1" != "$VERSION" ]; then
      echo "Error: server/package.json has version '$V1', expected '$VERSION'"
      ERROR=1
    fi
    if [ "$V2" != "$VERSION" ]; then
      echo "Error: .claude-plugin/marketplace.json has version '$V2', expected '$VERSION'"
      ERROR=1
    fi
    if [ "$V3" != "$VERSION" ]; then
      echo "Error: .claude-plugin/plugin.json has version '$V3', expected '$VERSION'"
      ERROR=1
    fi

    if [ "$ERROR" -eq 1 ]; then
      echo ""
      echo "Version mismatch detected! Please fix manually."
      exit 1
    fi

    echo "All files updated to $VERSION"
    ;;

  release)
    VERSION="$1"
    if [ -z "$VERSION" ]; then
      echo "Usage: echo 'release notes' | version-bump.sh release <version>"
      exit 1
    fi
    TAG="v$VERSION"

    # Read release notes from stdin
    NOTES=$(cat)
    if [ -z "$NOTES" ]; then
      echo "Error: Release notes must be provided via stdin"
      echo "Usage: echo 'release notes' | version-bump.sh release <version>"
      exit 1
    fi

    echo "Building..."
    cd server && bun run build && cd ..

    echo "Committing version files..."
    git add server/package.json .claude-plugin/marketplace.json .claude-plugin/plugin.json
    git commit -m "chore: bump version to $VERSION"

    echo "Creating tag $TAG..."
    git tag -a "$TAG" -m "Version $VERSION"

    echo "Pushing..."
    git push origin main && git push origin "$TAG"

    echo "Creating GitHub release..."
    echo "$NOTES" | gh release create "$TAG" --title "$TAG" --notes-file -

    echo "Generating CHANGELOG.md..."
    gh api repos/unsafe9/claude-lingo/releases --paginate | node -e "
const releases = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const lines = ['# Changelog', '', 'All notable changes to claude-lingo.', ''];
releases.slice(0, 50).forEach(r => {
  const date = r.published_at.split('T')[0];
  lines.push('## [' + r.tag_name + '] - ' + date);
  lines.push('');
  if (r.body) lines.push(r.body.trim());
  lines.push('');
});
console.log(lines.join('\n'));
" > CHANGELOG.md
    git add CHANGELOG.md
    git commit -m "docs: update CHANGELOG.md for v$VERSION"
    git push origin main

    echo ""
    echo "Release $TAG completed!"
    ;;

  *)
    echo "Usage: version-bump.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  check                Show current versions"
    echo "  update <version>     Update all version files"
    echo "  release <version>    Build, commit, tag, push, release, changelog"
    echo "                       (pipe release notes via stdin)"
    exit 1
    ;;
esac
