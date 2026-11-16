#!/usr/bin/env bash
# Stamp a build hash into the extension (manifest name/title + background +
# content) and the localhost page, and write build.json. Re-runnable: each
# run replaces the previous hash. After running, reload the extension in
# about:debugging and hard-refresh the page to pick up the new hash.
#
# Why: so you can tell at a glance you're running the latest build — the hash
# shows up in about:debugging's extension name, the toolbar button tooltip,
# the background console, the content-script ping response, and a badge on
# the page.

set -euo pipefail
cd "$(dirname "$0")"

HASH="$(date -u +%Y%m%d-%H%M%S)-$(openssl rand -hex 2)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# extHash = hash of the extension files, so the background can self-reload only
# when the EXT actually changed (not on page-only edits).
EXT_HASH="$(cat ff-ext/manifest.json ff-ext/background.js ff-ext/content.js | shasum -a 256 | awk '{print $1}')"

# Files carrying a stamp of the form  build:SOMETHING  (no spaces).
FILES=(ff-ext/manifest.json ff-ext/background.js ff-ext/content.js index.html)

# Re-stamp: replace any existing  build:<token>  with the new hash. The token
# matches [A-Za-z0-9._:-] (timestamp + hex + the literal __LAST__ placeholder).
for f in "${FILES[@]}"; do
  if [[ "$f" == *.json ]]; then
    # BSD sed (macOS) needs -i ''. Works on GNU sed too with '' as the backup ext? No — GNU sed -i '' edits in place with empty backup. To be portable, detect.
    if sed --version >/dev/null 2>&1; then
      sed -i -E "s/build:[A-Za-z0-9._:-]+/build:${HASH}/g" "$f"
    else
      sed -i '' -E "s/build:[A-Za-z0-9._:-]+/build:${HASH}/g" "$f"
    fi
  else
    if sed --version >/dev/null 2>&1; then
      sed -i -E "s/build:[A-Za-z0-9._:-]+/build:${HASH}/g" "$f"
    else
      sed -i '' -E "s/build:[A-Za-z0-9._:-]+/build:${HASH}/g" "$f"
    fi
  fi
done

cat > build.json <<EOF
{
  "hash": "${HASH}",
  "builtAt": "${BUILT_AT}",
  "extHash": "${EXT_HASH}",
  "files": [
    "ff-ext/manifest.json",
    "ff-ext/background.js",
    "ff-ext/content.js",
    "index.html"
  ]
}
EOF

echo "stamped build:${HASH}"
echo "  into: ${FILES[*]}"
echo "  build.json written."
echo ""
echo "Next: Firefox about:debugging → Reload the extension; hard-refresh http://localhost:8765/index.html"
echo "      Verify: extension name in about:debugging ends with [build:${HASH}];"
echo "      page bottom-left badge shows 'page build: build:${HASH}'."
