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

# A beta app is committed so its source is kept, but it is not released: no zip
# and no entry in the category manifest, which is all that the desktop App
# Store and the mvmos.org sync ever read. Remove "beta" from the manifest when
# the app is ready.
if python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])).get("beta") is True else 1)' "$SRC/apps/$APP_ID/manifest.json" 2>/dev/null; then
    echo "Refusing to release $APP_ID — its manifest.json says \"beta\": true."
    exit 1
fi

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
# install still gets the folder the app writes into. mvmCloud keeps its
# per-user files in a top-level storage/ directory instead, which went out
# with real user photos and vault data the first time this ran — same rule.
find "$TMP" -depth -type d -iname '*upload*' -exec sh -c 'find "$1" -mindepth 1 -delete' _ {} \;
find "$TMP" -depth -type d -iname 'storage' -exec sh -c 'find "$1" -mindepth 1 -delete' _ {} \;
# Working folders the app's CLI chats keep while running (mvmAI), never code.
find "$TMP" -depth -type d -name '.runtime' -exec rm -rf {} +
find "$TMP" -depth -type d -name '__pycache__' -exec rm -rf {} +
find "$TMP" -type f \( -name '*.py[cod]' -o -name '*.bak' -o -name '*.bak-*' \) -delete

cd "$TMP"
zip -r "$OUT" .
cd /
rm -rf "$TMP"

# Last line of defence: whatever the steps above missed, a package carrying
# uploads, databases, compiled Python, backups or premium code is not published.
BAD=$(unzip -Z1 "$OUT" | grep -iE '(^|/)[^/]*upload[^/]*/.+|(^|/)storage/.+|\.(db|sqlite|sqlite3)(-.*)?$|__pycache__|\.py[cod]$|\.bak(-.*)?$|(^|/)premium/|(^|/)(store|premium)\.json$')
if [ -n "$BAD" ]; then
    rm -f "$OUT"
    echo "Refusing to publish $OUT — it contains files that must never ship:"
    echo "$BAD"
    exit 1
fi

echo "Created: $OUT"
unzip -l "$OUT"

# The category manifest tells the desktop App Store which apps have Premium, so
# the card can carry the 💎 before anyone opens it, and what the app is called
# in every language. Both come from source/apps/<id> (premium.json and the
# manifest's name_i18n) and are derived here, never by hand.
python3 - "$APP_ID" "$CATEGORY" <<'PY'
import json, os, sys
app_id, category = sys.argv[1], sys.argv[2]
root = "/var/www/mvmos-store"
path = f"{root}/apps/{category}/manifest.json"
wanted = os.path.isfile(f"{root}/source/apps/{app_id}/premium.json")
try:
    source_manifest = json.load(open(f"{root}/source/apps/{app_id}/manifest.json", encoding="utf-8"))
    names = source_manifest.get("name_i18n")
except (OSError, ValueError):
    source_manifest = None
    names = None
raw = open(path, encoding="utf-8").read()
data = json.loads(raw)
changed = False
if source_manifest and not any(app.get("id") == app_id for app in data.get("apps", [])):
    entry = {key: source_manifest[key] for key in (
        "id", "name", "icon", "category", "version", "description", "tags", "min_core_version"
    ) if key in source_manifest}
    entry["zip_url"] = f"https://raw.githubusercontent.com/mvmrik/mvmos-store/main/apps/{category}/{app_id}-{source_manifest['version']}.zip"
    if wanted:
        entry["premium"] = True
    if names:
        entry["name_i18n"] = names
    data.setdefault("apps", []).append(entry)
    changed = True
    print(f"manifest: added {app_id} to {category}")
for app in data.get("apps", []):
    if app.get("id") != app_id:
        continue
    if bool(app.get("premium")) != wanted:
        if wanted:
            app["premium"] = True
        else:
            app.pop("premium", None)
        changed = True
        print(f"manifest: premium={'true' if wanted else 'removed'} for {app_id}")
    if app.get("name_i18n") != names:
        if names:
            app["name_i18n"] = names
        else:
            app.pop("name_i18n", None)
        changed = True
        print(f"manifest: name_i18n {'set' if names else 'removed'} for {app_id}")
if changed:
    open(path, "w", encoding="utf-8").write(json.dumps(data, indent=2, ensure_ascii=False) + ("\n" if raw.endswith("\n") else ""))
PY

# The premium build is skipped above on purpose, but it still has to reach
# mvmos.org or the change stops in source/ with nothing to signal it. Publish
# it here so releasing an app always publishes both halves in one step.
if [ -d "$SRC/apps/$APP_ID/premium" ] || [ -d "$SRC/backend/apps/$APP_ID/premium" ]; then
    echo
    echo "--- premium build found, publishing to mvmos.org ---"
    /var/www/mvmos-store/make-premium-zip.sh "$APP_ID"
fi
