#!/bin/bash
# Usage: ./make-core-premium-zip.sh <module>
# Packages a premium build of mvmOS itself and publishes it to mvmos.org.
#
# Core premium works exactly like an app's: the code is in no repository, it is
# served from mvmos.org, and download_core_premium(<module>) fetches it only
# for an installation with a valid licence. An unlicensed one never receives
# the file and therefore has nothing to unlock.
#
# Structure:
#   /var/www/mvmos.mvmrik.com/backend/premium/<module>/*  ->  (root)
#
# The live folder is the source. There is no source/ mirror for it, precisely
# because premium code must never end up in a public checkout — which also
# means the published zip is the only other copy that exists. Run this after
# every change, and never while the folder is missing: removing the licence
# deletes it, and packaging an empty folder destroys the working build on
# mvmos.org.

MODULE="$1"

if [ -z "$MODULE" ]; then
    echo "Usage: $0 <module>"
    exit 1
fi

SRC=/var/www/mvmos.mvmrik.com/backend/premium/$MODULE
DEST_DIR=/var/www/mvmos.org/premium/core/$MODULE
OUT=$DEST_DIR/premium.zip
TMP=/tmp/corepremziptmp-$$

if [ ! -d "$SRC" ]; then
    echo "No core premium build found for '$MODULE'."
    echo "Looked in: $SRC"
    echo "Nothing was published — the existing zip on mvmos.org is untouched."
    exit 1
fi

if [ -z "$(ls -A "$SRC" 2>/dev/null)" ]; then
    echo "'$SRC' is empty — refusing to publish an empty build."
    exit 1
fi

mkdir -p "$TMP"
cp -r "$SRC/." "$TMP/" 2>/dev/null

find "$TMP" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null
find "$TMP" -name "*.db" -delete 2>/dev/null

if [ -z "$(ls -A "$TMP" 2>/dev/null)" ]; then
    echo "Nothing left to package after cleaning — refusing to publish."
    rm -rf "$TMP"
    exit 1
fi

mkdir -p "$DEST_DIR"
rm -f "$OUT"

cd "$TMP"
zip -r "$OUT" . >/dev/null
cd /
rm -rf "$TMP"

chown -R www-data:www-data "$DEST_DIR"

echo "Created: $OUT"
unzip -l "$OUT"
