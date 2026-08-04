#!/usr/bin/env bash
#
# Brings up the FortiClient SSL-VPN tunnel this container exists to hold open.
#
# Everything is handed to openfortivpn through its config file rather than
# argv or an expect script. That is not a style preference:
#
#   * argv is world-readable via /proc, so the password would be visible to
#     anything that can run `ps` in this namespace;
#   * driving the password through expect meant pasting it into a Tcl script,
#     where a password containing "$24" made Tcl look for a variable named
#     "24" ("can't read \"24\": no such variable") and a password containing
#     brackets would have been executed as a Tcl command outright.
#
# openfortivpn reads `password =` from the config file literally, to end of
# line, so no character in a password is special to anything here.

set -euo pipefail

# Positional arguments win, environment is the fallback -- as before.
HOST="${1:-${VPN_HOST:-}}"
PORT="${2:-${VPN_PORT:-}}"
USERNAME="${3:-${VPN_USER:-}}"
PASSWORD="${4:-${VPN_PASS:-}}"

# Optional: the SHA-256 digest of the gateway's certificate, for a gateway
# whose certificate does NOT chain to a public CA. Unset is the normal case
# and means "validate the certificate properly, like any other TLS client".
TRUSTED_CERT="${VPN_TRUSTED_CERT:-}"

missing=()
[[ -n $HOST ]] || missing+=(VPN_HOST)
[[ -n $PORT ]] || missing+=(VPN_PORT)
[[ -n $USERNAME ]] || missing+=(VPN_USER)
[[ -n $PASSWORD ]] || missing+=(VPN_PASS)
if ((${#missing[@]})); then
    echo "Error: missing required setting(s): ${missing[*]}" >&2
    exit 1
fi

CONFIG_DIR="$HOME/.config/openfortivpn"
CONFIG_FILE="$CONFIG_DIR/config"
mkdir -p "$CONFIG_DIR"

# Written under umask 077 rather than chmod'ed afterwards, so the credentials
# are never briefly on disk world-readable.
(
    umask 077
    {
        printf 'host = %s\n' "$HOST"
        printf 'port = %s\n' "$PORT"
        printf 'username = %s\n' "$USERNAME"
        printf 'password = %s\n' "$PASSWORD"
        if [[ -n $TRUSTED_CERT ]]; then
            printf 'trusted-cert = %s\n' "$TRUSTED_CERT"
        fi
    } > "$CONFIG_FILE"
)

if [[ -n $TRUSTED_CERT ]]; then
    echo "Connecting to $HOST:$PORT (pinned certificate ${TRUSTED_CERT:0:16}...)"
else
    echo "Connecting to $HOST:$PORT (validating certificate against system CAs)"
fi

# Set VPN_RECONNECT=0 to get the old behaviour: one attempt, then exit.
RECONNECT="${VPN_RECONNECT:-1}"
# Backoff between attempts, in seconds. Capped rather than unbounded so a
# gateway that is down for an hour is retried every minute instead of once.
DELAY_MIN="${VPN_RETRY_DELAY:-5}"
DELAY_MAX="${VPN_RETRY_MAX_DELAY:-60}"
# A session that stayed up at least this long counts as "it worked" and
# resets the backoff, so a drop after a good day reconnects in seconds.
STABLE_AFTER=60

vpn_pid=""
stopping=0

# docker stop sends TERM to this script, not to the tunnel it is supervising.
# Without relaying it the container would sit through the whole grace period
# and then be killed, dropping the tunnel uncleanly.
on_term() {
    stopping=1
    if [[ -n $vpn_pid ]]; then
        kill -TERM "$vpn_pid" 2>/dev/null || true
        wait "$vpn_pid" 2>/dev/null || true
    fi
    echo "Stopped."
    exit 0
}
trap on_term TERM INT

delay=$DELAY_MIN
while true; do
    started=$SECONDS

    # Backgrounded rather than exec'd so this script stays alive as the
    # container's main process: the tunnel dropping is a thing to recover
    # from, not the end of the container.
    sudo /usr/bin/openfortivpn -c "$CONFIG_FILE" &
    vpn_pid=$!
    wait "$vpn_pid" || status=$?
    status=${status:-0}
    vpn_pid=""

    ((stopping)) && exit 0

    lasted=$((SECONDS - started))
    if ((lasted >= STABLE_AFTER)); then
        delay=$DELAY_MIN
    fi

    if [[ $RECONNECT != 1 ]]; then
        echo "Tunnel exited (status $status) after ${lasted}s; VPN_RECONNECT=0, not retrying."
        exit "$status"
    fi

    echo "Tunnel exited (status $status) after ${lasted}s; reconnecting in ${delay}s."
    # Backgrounded so the TERM trap interrupts the wait instead of the
    # container hanging here for the rest of the delay.
    sleep "$delay" &
    wait $! 2>/dev/null || true
    ((stopping)) && exit 0

    delay=$((delay * 2))
    ((delay > DELAY_MAX)) && delay=$DELAY_MAX
done
