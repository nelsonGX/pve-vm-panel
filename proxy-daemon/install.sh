#!/usr/bin/env bash
# ===========================================================================
# install.sh — Set up the pve-vm-panel WireGuard proxy daemon
#
# Run as root on a fresh Debian/Ubuntu server that will act as the VPN proxy.
# ===========================================================================
set -euo pipefail

INSTALL_DIR=/opt/wg-daemon
SERVICE_FILE=/etc/systemd/system/wg-daemon.service

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
ask() {
    # ask <var_name> <prompt> [default]
    local var="$1"
    local prompt="$2"
    local default="${3:-}"
    local value=""

    if [[ -n "$default" ]]; then
        read -rp "  $prompt [$default]: " value
        value="${value:-$default}"
    else
        while [[ -z "$value" ]]; do
            read -rp "  $prompt: " value
            [[ -z "$value" ]] && echo "    (required — cannot be empty)"
        done
    fi
    printf -v "$var" '%s' "$value"
}

ask_yn() {
    # ask_yn <prompt> <default y|n>  → returns 0 for yes, 1 for no
    local prompt="$1"
    local default="${2:-y}"
    local reply
    read -rp "  $prompt [${default}]: " reply
    reply="${reply:-$default}"
    [[ "$reply" =~ ^[Yy] ]]
}

section() { echo ""; echo "==> $*"; }

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------
section "Installing system packages..."
apt-get update -q
apt-get install -y -q wireguard wireguard-tools python3 python3-venv python3-pip iptables

section "Enabling IP forwarding..."
if ! grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf 2>/dev/null; then
    echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
fi
sysctl -q -w net.ipv4.ip_forward=1

# ---------------------------------------------------------------------------
# WireGuard keypair
# ---------------------------------------------------------------------------
section "Generating WireGuard server keypair..."
PRIVATE_KEY=$(wg genkey)
PUBLIC_KEY=$(echo "$PRIVATE_KEY" | wg pubkey)

echo ""
echo "  ┌─────────────────────────────────────────────────────────────┐"
echo "  │  Server public key (copy this into the panel .env):         │"
echo "  │  VPN_SERVER_PUBLIC_KEY=$PUBLIC_KEY"
echo "  └─────────────────────────────────────────────────────────────┘"
echo ""

# ---------------------------------------------------------------------------
# Interactive configuration prompts
# ---------------------------------------------------------------------------
section "Configuration"
echo "  Answer the prompts below. Press Enter to accept the [default]."
echo ""

ask PANEL_API_URL  "Panel API URL (e.g. https://panel.example.com/api/v1)"
ask DAEMON_SECRET  "Daemon secret (must match VPN_DAEMON_SECRET in panel .env)"
ask WG_INTERFACE   "WireGuard interface name" "wg0"
ask WG_LISTEN_PORT "WireGuard listen port"    "51820"
ask SYNC_INTERVAL  "Peer sync interval (seconds)" "30"

# Detect default outbound interface for iptables rules
DEFAULT_IFACE=$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')
DEFAULT_IFACE="${DEFAULT_IFACE:-eth0}"
ask NET_IFACE "Outbound network interface (for iptables NAT)" "$DEFAULT_IFACE"

WG_POSTUP="iptables -A FORWARD -i ${WG_INTERFACE} -j ACCEPT; iptables -A FORWARD -o ${WG_INTERFACE} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${NET_IFACE} -j MASQUERADE"
WG_POSTDOWN="iptables -D FORWARD -i ${WG_INTERFACE} -j ACCEPT; iptables -D FORWARD -o ${WG_INTERFACE} -j ACCEPT; iptables -t nat -D POSTROUTING -o ${NET_IFACE} -j MASQUERADE"

echo ""
echo "  Summary:"
echo "    PANEL_API_URL  = $PANEL_API_URL"
echo "    DAEMON_SECRET  = ${DAEMON_SECRET:0:4}$(printf '*%.0s' $(seq 1 $((${#DAEMON_SECRET}-4))))"
echo "    WG_INTERFACE   = $WG_INTERFACE"
echo "    WG_LISTEN_PORT = $WG_LISTEN_PORT"
echo "    SYNC_INTERVAL  = ${SYNC_INTERVAL}s"
echo "    NET_IFACE      = $NET_IFACE"
echo ""

if ! ask_yn "Proceed with these settings?" "y"; then
    echo "Aborted."
    exit 1
fi

# ---------------------------------------------------------------------------
# Install files
# ---------------------------------------------------------------------------
section "Creating install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

section "Copying daemon files..."
cp daemon.py "$INSTALL_DIR/"
cp requirements.txt "$INSTALL_DIR/"

section "Writing $INSTALL_DIR/.env..."
cat > "$INSTALL_DIR/.env" <<EOF
PANEL_API_URL=${PANEL_API_URL}
DAEMON_SECRET=${DAEMON_SECRET}
WG_INTERFACE=${WG_INTERFACE}
WG_CONF_PATH=/etc/wireguard/${WG_INTERFACE}.conf
WG_SERVER_PRIVATE_KEY=${PRIVATE_KEY}
WG_LISTEN_PORT=${WG_LISTEN_PORT}
SYNC_INTERVAL=${SYNC_INTERVAL}
WG_POSTUP=${WG_POSTUP}
WG_POSTDOWN=${WG_POSTDOWN}
EOF
chmod 600 "$INSTALL_DIR/.env"

section "Setting up Python virtual environment..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install -q --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install -q -r requirements.txt

section "Installing systemd service..."
sed "s|/opt/wg-daemon|$INSTALL_DIR|g" wg-daemon.service > "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable wg-daemon

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "==> Installation complete!"
echo ""
echo "  Public key for panel .env:"
echo "    VPN_SERVER_PUBLIC_KEY=$PUBLIC_KEY"
echo ""
echo "  To start the daemon:"
echo "    systemctl start wg-daemon"
echo ""
echo "  To watch logs:"
echo "    journalctl -u wg-daemon -f"
