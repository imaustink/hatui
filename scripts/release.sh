#!/usr/bin/env bash
set -euo pipefail

BUMP=${1:-patch}

if [[ ! "$BUMP" =~ ^(major|minor|patch)$ ]]; then
  echo "Usage: $0 [major|minor|patch]"
  exit 1
fi

# Ensure working tree is clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree is not clean. Commit or stash changes first."
  exit 1
fi

# Bump version, commit, and create tag
npm version "$BUMP" -m "chore: release v%s"

# Push commit and tag
git push && git push --tags

echo "Released $(node -p "require('./package.json').version")"
