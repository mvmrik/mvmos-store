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

# store.json and premium.json are listing metadata for mvmos.org, read straight
# from GitHub by the site's store sync. They must never travel in the zip:
# _install_from_zip() routes anything it does not recognise into apps/<id>/public/,
# which is the one folder served over HTTP.
rm -f "$TMP/store.json" "$TMP/premium.json"
# Runtime databases belong to a particular installation and may contain user
# data.  A Store package must carry only schema (db.json), never a database or
# its SQLite journal files.
rm -f "$TMP"/*.db "$TMP"/*.db-* "$TMP"/*.sqlite "$TMP"/*.sqlite-* "$TMP"/*.sqlite3 "$TMP"/*.sqlite3-*

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

# Runtime content of this installation never ships. Anything users uploaded
# lives under an *upload* directory, and the copy above takes it along with the
# rest of public/ — shoppinglist-1.2.2 went out with photos in it because this
# was a manual step afterwards. The directories themselves stay, empty, so an
# install still gets the folder the app writes into.
find "$TMP" -depth -type d -iname '*upload*' -exec sh -c 'find "$1" -mindepth 1 -delete' _ {} \;
find "$TMP" -depth -type d -name '__pycache__' -exec rm -rf {} +
find "$TMP" -type f \( -name '*.py[cod]' -o -name '*.bak' -o -name '*.bak-*' \) -delete

cd "$TMP"
zip -r "$OUT" .
cd /
rm -rf "$TMP"

# Last line of defence: whatever the steps above missed, a package carrying
# uploads, databases, compiled Python, backups or premium code is not published.
BAD=$(unzip -Z1 "$OUT" | grep -iE '(^|/)[^/]*upload[^/]*/.+|\.(db|sqlite|sqlite3)(-.*)?$|__pycache__|\.py[cod]$|\.bak(-.*)?$|(^|/)premium/|(^|/)(store|premium)\.json$')
if [ -n "$BAD" ]; then
    rm -f "$OUT"
    echo "Refusing to publish $OUT — it contains files that must never ship:"
    echo "$BAD"
    exit 1
fi

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
