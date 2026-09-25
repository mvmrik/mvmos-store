#!/bin/bash
# mvmos-display — shows mvmOS full screen on this computer's own screen.
#
# Installed by the Local Display app as /usr/local/bin/mvmos-display. The app
# and this command do the same thing, so the screen can be switched on from
# the desktop, from the local terminal or over SSH:
#
#   sudo mvmos-display start     show mvmOS on the screen now
#   sudo mvmos-display stop      back to the text console
#   sudo mvmos-display enable    show it every time the computer starts
#   sudo mvmos-display disable   start in the text console again
#   mvmos-display status
#
# The screen runs as its own unprivileged user in a kiosk: cage (a Wayland
# compositor that shows exactly one program full screen) with a browser in it,
# on tty1 in place of the login prompt.

set -u

NAME=mvmos-display
SELF=/usr/local/bin/$NAME
CONF=/etc/$NAME.conf
UNIT=/etc/systemd/system/$NAME.service
PAM=/etc/pam.d/$NAME
KIOSK_USER=$NAME
KIOSK_HOME=/home/$KIOSK_USER
# What setup installed that was not on the system before, one "apt <pkg>" or
# "snap <name>" per line, so removing the app takes exactly that back off.
STATE=/var/lib/$NAME/installed

die() { echo "$NAME: $*" >&2; exit 1; }
need_root() { [ "$(id -u)" = 0 ] || die "run it with sudo: sudo $NAME $1"; }

url() {
  local URL=""
  [ -r "$CONF" ] && . "$CONF"
  [ -n "$URL" ] || die "$CONF is missing; open the Local Display app once in mvmOS"
  echo "$URL"
}

browser() {
  local b
  for b in /usr/bin/chromium /snap/bin/chromium /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
    [ -x "$b" ] && { echo "$b"; return 0; }
  done
  return 1
}

apt_list() { dpkg-query -W -f '${Package}\n' 2>/dev/null | sort; }
snap_list() { command -v snap >/dev/null && snap list 2>/dev/null | awk 'NR>1{print $1}' | sort; }

# Appends to STATE what appeared since setup took the lists. Runs on exit, so
# an install that fails halfway is recorded too.
BEFORE_APT="" BEFORE_SNAP=""
remember() {
  [ -n "$BEFORE_APT" ] || return 0
  mkdir -p "$(dirname "$STATE")"
  comm -13 "$BEFORE_APT" <(apt_list) | sed 's/^/apt /' >> "$STATE"
  comm -13 "$BEFORE_SNAP" <(snap_list) | sed 's/^/snap /' >> "$STATE"
  rm -f "$BEFORE_APT" "$BEFORE_SNAP"
  BEFORE_APT=""
}

installed() { command -v cage >/dev/null && browser >/dev/null && [ -f "$UNIT" ] && id "$KIOSK_USER" >/dev/null 2>&1; }

setup() {
  need_root setup
  command -v apt-get >/dev/null || die "only Debian and Ubuntu based systems are supported"
  BEFORE_APT=$(mktemp); BEFORE_SNAP=$(mktemp)
  apt_list > "$BEFORE_APT"; snap_list > "$BEFORE_SNAP"
  trap remember EXIT
  if ! command -v cage >/dev/null; then
    echo "Installing cage..."
    DEBIAN_FRONTEND=noninteractive apt-get update -q || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q cage || die "could not install cage"
  fi
  if ! browser >/dev/null; then
    # Debian ships a real chromium package; on Ubuntu it only exists as a snap.
    if apt-cache policy chromium 2>/dev/null | grep -q 'Candidate: [0-9]'; then
      echo "Installing chromium..."
      DEBIAN_FRONTEND=noninteractive apt-get install -y -q chromium || die "could not install chromium"
    else
      echo "Installing chromium (snap)..."
      command -v snap >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q snapd || die "could not install snapd"
      snap install chromium || die "could not install chromium"
    fi
  fi
  if ! id "$KIOSK_USER" >/dev/null 2>&1; then
    useradd --create-home --home-dir "$KIOSK_HOME" --shell /usr/sbin/nologin "$KIOSK_USER" || die "could not create user $KIOSK_USER"
  fi
  local g
  for g in video render input; do
    getent group "$g" >/dev/null && usermod -aG "$g" "$KIOSK_USER"
  done

  cat > "$PAM" <<'EOF'
auth     required pam_unix.so nullok
account  required pam_unix.so
session  required pam_unix.so
session  required pam_systemd.so
EOF

  cat > "$UNIT" <<EOF
[Unit]
Description=mvmOS on this computer's screen
After=systemd-user-sessions.service plymouth-quit-wait.service dbus.socket systemd-logind.service getty@tty1.service
Wants=dbus.socket systemd-logind.service
Conflicts=getty@tty1.service
ConditionPathExists=/dev/tty1

[Service]
Type=simple
User=$KIOSK_USER
PAMName=$NAME
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
UtmpMode=user
Environment=XDG_SESSION_TYPE=wayland
ExecStart=$SELF run
# Closing the browser or stopping the service gives tty1 its login prompt back.
ExecStopPost=+/bin/systemctl --no-block start getty@tty1.service
Restart=no
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  remember
}

# Runs inside the service as the kiosk user.
run() {
  local u b host port
  u=$(url) || exit 1
  b=$(browser) || die "no browser installed; run: sudo $NAME start"
  # At boot mvmOS itself may still be starting; wait for it (up to a minute)
  # so the screen does not open on a connection error.
  host=$(echo "$u" | sed -E 's#^[a-z]+://([^:/]+).*#\1#')
  port=$(echo "$u" | sed -nE 's#^[a-z]+://[^:/]+:([0-9]+).*#\1#p')
  for _ in $(seq 60); do
    (exec 3<>"/dev/tcp/$host/${port:-80}") 2>/dev/null && break
    sleep 1
  done
  # -s keeps Ctrl+Alt+F2 etc. working, so another console is always reachable.
  exec cage -s -- "$b" --kiosk --no-first-run --noerrdialogs --disable-infobars \
    --disable-session-crashed-bubble --disable-features=Translate \
    --password-store=basic --ozone-platform=wayland \
    --check-for-update-interval=31536000 "$u"
}

status() {
  echo "screen:    $(screens || echo none)"
  echo "installed: $(installed && echo yes || echo no)"
  echo "running:   $(systemctl is-active "$NAME" 2>/dev/null || true)"
  echo "at boot:   $(systemctl is-enabled "$NAME" 2>/dev/null || echo disabled)"
  [ -r "$CONF" ] && echo "address:   $(url)"
}

screens() {
  local s found=""
  for s in /sys/class/drm/card*-*/status; do
    [ -r "$s" ] && [ "$(cat "$s")" = connected ] && found="$found $(basename "$(dirname "$s")" | sed 's/^card[0-9]*-//')"
  done
  [ -n "$found" ] && echo "${found# }"
}

# Takes off what setup installed, and only that: a snap is kept while another
# snap still uses it, and an apt package only goes when apt itself would
# autoremove it, so nothing installed or needed since then is touched.
remove_packages() {
  [ -r "$STATE" ] || return 0
  local s pkgs left kept
  if command -v snap >/dev/null; then
    # chromium first, then the rest in passes: a base such as core22 can only
    # go once the snaps built on it are gone, so a pass that removes something
    # is followed by another.
    local todo next progress=1
    todo="chromium $(awk '$1=="snap" && $2!="chromium"{print $2}' "$STATE")"
    while [ "$progress" = 1 ]; do
      progress=0; next=""
      for s in $todo; do
        grep -qx "snap $s" "$STATE" || continue
        snap list "$s" >/dev/null 2>&1 || continue
        # A theme or library snap another snap is connected to stays.
        if ! snap connections "$s" 2>/dev/null | awk -v s="$s" 'NR>1 && $2 != "-" && $3 ~ "^"s":" && $2 !~ "^"s":"' | grep -q . \
           && snap remove --purge "$s" >/dev/null 2>&1; then
          echo "Removed snap $s."; progress=1
        else
          next="$next $s"
        fi
      done
      todo=$next
    done
    for s in $todo; do echo "kept snap $s (another snap uses it)"; done
  fi
  pkgs=$(awk '$1=="apt"{print $2}' "$STATE")
  if [ -n "$pkgs" ]; then
    # The two packages setup asked for become automatic like their
    # dependencies, so all of them are autoremove candidates unless something
    # needs them. snapd stays: other snaps may have come to rely on it.
    for s in cage chromium; do
      echo "$pkgs" | grep -qx "$s" && apt-mark auto "$s" >/dev/null 2>&1
    done
    left=$(apt-get -s autoremove 2>/dev/null | awk '/^Remv /{print $2}' | grep -Fx -f <(echo "$pkgs"))
    if [ -n "$left" ]; then
      echo "Removing $(echo $left)..."
      DEBIAN_FRONTEND=noninteractive apt-get purge -y -q $left
    fi
    kept=$(comm -12 <(echo "$pkgs" | sort) <(apt_list))
    [ -n "$kept" ] && echo "kept, other software needs them: $(echo $kept)"
  fi
  rm -rf "$(dirname "$STATE")"
}

remove() {
  need_root remove
  systemctl disable --now "$NAME" 2>/dev/null
  rm -f "$UNIT" "$PAM" "$CONF"
  systemctl daemon-reload
  systemctl reset-failed "$NAME" 2>/dev/null
  if id "$KIOSK_USER" >/dev/null 2>&1; then
    # The Chromium snap runs in its own scope, so stopping the service can
    # leave its processes behind, and userdel refuses a user that still has any.
    pkill -KILL -u "$KIOSK_USER" 2>/dev/null
    for _ in 1 2 3 4 5; do pgrep -u "$KIOSK_USER" >/dev/null || break; sleep 1; done
    userdel -r "$KIOSK_USER" 2>/dev/null
    id "$KIOSK_USER" >/dev/null 2>&1 && echo "could not remove user $KIOSK_USER"
  fi
  systemctl --no-block start getty@tty1.service 2>/dev/null
  remove_packages
  rm -f "$SELF"
  echo "Removed."
}

case "${1:-}" in
  start)   need_root start; url >/dev/null || exit 1; installed || setup || exit 1
           systemctl start "$NAME" && echo "mvmOS is now on the screen." ;;
  stop)    need_root stop; systemctl stop "$NAME"; echo "Back to the text console." ;;
  enable)  need_root enable; url >/dev/null || exit 1; installed || setup || exit 1
           systemctl enable "$NAME" && echo "mvmOS will be shown on the screen when the computer starts." ;;
  disable) need_root disable; systemctl disable "$NAME"; echo "The computer will start in the text console." ;;
  status)  status ;;
  setup)   setup ;;
  run)     run ;;
  remove)  remove ;;
  *)       sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
