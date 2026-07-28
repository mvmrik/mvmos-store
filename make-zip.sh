#!/bin/bash
# Usage: ./make-zip.sh <app-id> <version> <category>
# Example: ./make-zip.sh gamehub 1.10.5 games

APP_ID="$1"
VERSION="$2"
CATEGORY="$3"

if [ -z "$APP_ID" ] || [ -z "$VERSION" ] || [ -z "$CATEGORY" ]; then
    echo "Usage: $0 <app-id> <version> <category>"
    exit 1
fi

SRC=/var/www/mvmos-store/source
OUT=/var/www/mvmos-store/apps/$CATEGORY/$APP_ID-$VERSION.zip
TMP=/tmp/ziptmp-$$

# Remove old zip
rm -f /var/www/mvmos-store/apps/$CATEGORY/$APP_ID-*.zip

mkdir -p "$TMP"

# Copy frontend files flat
cp "$SRC/apps/$APP_ID/"* "$TMP/" 2>/dev/null

# Copy backend files if they exist
if [ -d "$SRC/backend/apps/$APP_ID" ]; then
    mkdir -p "$TMP/backend"
    cp "$SRC/backend/apps/$APP_ID/"* "$TMP/backend/" 2>/dev/null
    # Copy subdirectories (e.g. public/)
    for dir in "$SRC/backend/apps/$APP_ID"/*/; do
        [ "$(basename "$dir")" = "premium" ] && continue   # subscriber-only, served from mvmos.org
        [ -d "$dir" ] && cp -r "$dir" "$TMP/backend/"
    done
fi

# Copy frontend subdirectories (e.g. public/ in gamehub)
for dir in "$SRC/apps/$APP_ID"/*/; do
    [ "$(basename "$dir")" = "premium" ] && continue   # subscriber-only, served from mvmos.org
    [ -d "$dir" ] && cp -r "$dir" "$TMP/"
done

cd "$TMP"
zip -r "$OUT" .
cd /
rm -rf "$TMP"

echo "Created: $OUT"
unzip -l "$OUT"

# The premium build is skipped above on purpose, but it still has to reach
# mvmos.org or the change stops in source/ with nothing to signal it. Publish
# it here so releasing an app always publishes both halves in one step.
if [ -d "$SRC/apps/$APP_ID/premium" ] || [ -d "$SRC/backend/apps/$APP_ID/premium" ]; then
    echo
    echo "--- premium build found, publishing to mvmos.org ---"
    /var/www/mvmos-store/make-premium-zip.sh "$APP_ID"
fi
