#!/bin/bash
# Usage: ./make-premium-zip.sh <app-id>
# Packages an app's premium build and publishes it to mvmos.org.
#
# Premium code never travels in the public store zip (make-zip.sh skips any
# premium/ directory) — it is served from mvmos.org and fetched by
# download_premium(app_id) only for installs with a valid licence.
#
# Structure, mirroring a regular app zip:
#   source/apps/<id>/premium/*          ->  (root)
#   source/backend/apps/<id>/premium/*  ->  backend/
#
# A premium module belongs in source/apps/<id>/premium/ — it is ordinary app
# code, loaded confined to the app's own folder, and needing premium is not a
# reason for an app to have a backend. Only an app that already has an
# approved backend/apps/<id>/ should ship the backend/ half.

APP_ID="$1"

if [ -z "$APP_ID" ]; then
    echo "Usage: $0 <app-id>"
    exit 1
fi

SRC=/var/www/mvmos-store/source
DEST_DIR=/var/www/mvmos.org/premium/apps/$APP_ID
OUT=$DEST_DIR/premium.zip
TMP=/tmp/premziptmp-$$

FE_SRC="$SRC/apps/$APP_ID/premium"
BE_SRC="$SRC/backend/apps/$APP_ID/premium"

if [ ! -d "$FE_SRC" ] && [ ! -d "$BE_SRC" ]; then
    echo "No premium build found for '$APP_ID'."
    echo "Looked in: $FE_SRC"
    echo "           $BE_SRC"
    exit 1
fi

mkdir -p "$TMP"

# Frontend premium files flat at the root
if [ -d "$FE_SRC" ]; then
    cp -r "$FE_SRC/." "$TMP/" 2>/dev/null
fi

# Backend premium files under backend/
if [ -d "$BE_SRC" ]; then
    mkdir -p "$TMP/backend"
    cp -r "$BE_SRC/." "$TMP/backend/" 2>/dev/null
fi

find "$TMP" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find "$TMP" -name "*.db" -delete 2>/dev/null

mkdir -p "$DEST_DIR"
rm -f "$OUT"

cd "$TMP"
zip -r "$OUT" . >/dev/null
cd /
rm -rf "$TMP"

chown www-data:www-data "$OUT"

echo "Created: $OUT"
unzip -l "$OUT"
