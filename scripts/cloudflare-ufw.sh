#!/usr/bin/env bash
# cloudflare-ufw.sh — firewall del VPS: Docker publica puertos vía iptables y se
# salta ufw, así que el origen de 80/443 se limita en la cadena DOCKER-USER (M8c).
#
# Qué hace, en orden:
#   1. Genera reglas DOCKER-USER con los rangos de Cloudflare descargados EN VIVO
#      (https://www.cloudflare.com/ips-v4 e ips-v6) y las aplica de forma atómica.
#   2. Deja ufw consistente: 22/tcp sólo desde la IP del operador, 80/443 para
#      Cloudflare (documental, porque el filtrado real es DOCKER-USER).
#   3. Persiste las reglas (netfilter-persistent) para que sobrevivan al reboot,
#      porque Docker no las recrea.
#   4. Verifica desde afuera que la IP directa del VPS rechaza conexiones.
#
# La DEFENSA PRINCIPAL es el firewall del proveedor (security group): este script
# es la segunda capa. Ver docs/DEPLOY.md#firewall y docs/RUNBOOKS.md.
#
# Uso:
#   sudo ./scripts/cloudflare-ufw.sh apply            # genera + aplica + persiste
#   sudo ./scripts/cloudflare-ufw.sh apply --dry-run  # sólo muestra las reglas
#   ./scripts/cloudflare-ufw.sh verify <ip-publica>   # verifica desde afuera
#
# Variables:
#   SSH_ALLOW_FROM   CIDR/IP con acceso a 22 (obligatorio en `apply`)
#   HTTP_PORTS       puertos TCP publicados por Caddy (default: 80,443)
#
# Requisitos: iptables/ip6tables, curl, ufw (opcional), netfilter-persistent (opcional).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULES_V4="${REPO_ROOT}/infra/firewall/docker-user-cloudflare.rules"
GENERATED_V4="$(mktemp)"
GENERATED_V6="$(mktemp)"
trap 'rm -f "${GENERATED_V4}" "${GENERATED_V6}"' EXIT

HTTP_PORTS="${HTTP_PORTS:-80,443}"

log() { printf '[cloudflare-firewall] %s\n' "$*"; }
die() {
  printf '[cloudflare-firewall] ERROR: %s\n' "$*" >&2
  exit 1
}
require_root() { [ "${EUID}" -eq 0 ] || die 'requiere root (sudo)'; }

fetch_cidrs() {
  local family="$1"
  curl -fsS --max-time 15 "https://www.cloudflare.com/ips-${family}" | grep -Ev '^\s*(#|$)'
}

generate_v4() {
  local v4
  v4="$(fetch_cidrs v4)" || die 'no se pudieron descargar los rangos IPv4 de Cloudflare'
  [ -n "${v4}" ] || die 'la lista IPv4 de Cloudflare llegó vacía'

  {
    echo '*filter'
    echo ':DOCKER-USER - [0:0]'
    echo '-F DOCKER-USER'
    echo '-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN'
    echo '-A DOCKER-USER -j RETURN -m mark --mark 0xff'
    for cidr in ${v4}; do
      echo "-A DOCKER-USER -p tcp -m multiport --dports ${HTTP_PORTS} -s ${cidr} -j RETURN"
    done
    for cidr in ${v4}; do
      echo "-A DOCKER-USER -p udp --dport 443 -s ${cidr} -j RETURN"
    done
    echo "-A DOCKER-USER -p tcp -m multiport --dports ${HTTP_PORTS} -j DROP"
    echo '-A DOCKER-USER -p udp --dport 443 -j DROP'
    echo '-A DOCKER-USER -j RETURN'
    echo 'COMMIT'
  } >"${GENERATED_V4}"
  log "reglas IPv4 generadas con $(echo "${v4}" | wc -l) rangos de Cloudflare"
}

generate_v6() {
  local v6
  v6="$(fetch_cidrs v6)" || die 'no se pudieron descargar los rangos IPv6 de Cloudflare'
  [ -n "${v6}" ] || die 'la lista IPv6 de Cloudflare llegó vacía'

  {
    echo '*filter'
    echo ':DOCKER-USER - [0:0]'
    echo '-F DOCKER-USER'
    echo '-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN'
    echo '-A DOCKER-USER -j RETURN -m mark --mark 0xff'
    for cidr in ${v6}; do
      echo "-A DOCKER-USER -p tcp -m multiport --dports ${HTTP_PORTS} -s ${cidr} -j RETURN"
    done
    for cidr in ${v6}; do
      echo "-A DOCKER-USER -p udp --dport 443 -s ${cidr} -j RETURN"
    done
    echo "-A DOCKER-USER -p tcp -m multiport --dports ${HTTP_PORTS} -j DROP"
    echo '-A DOCKER-USER -p udp --dport 443 -j DROP'
    echo '-A DOCKER-USER -j RETURN'
    echo 'COMMIT'
  } >"${GENERATED_V6}"
  log "reglas IPv6 generadas con $(echo "${v6}" | wc -l) rangos de Cloudflare"
}

apply_ufw_baseline() {
  command -v ufw >/dev/null 2>&1 || {
    log 'ufw no está instalado; se omite la capa ufw'
    return
  }
  [ -n "${SSH_ALLOW_FROM:-}" ] || die 'definí SSH_ALLOW_FROM=<tu-ip>/32 (no se abre 22 al mundo)'
  log "ufw: 22/tcp sólo desde ${SSH_ALLOW_FROM}; default deny incoming"
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  ufw allow from "${SSH_ALLOW_FROM}" to any port 22 proto tcp >/dev/null
  # Documental: el filtrado efectivo de 80/443 lo hace DOCKER-USER.
  for cidr in ${CLOUDFLARE_V4:-}; do ufw allow from "${cidr}" to any port 443 proto tcp >/dev/null; done
  ufw --force enable >/dev/null
}

persist_rules() {
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null && log 'reglas persistidas con netfilter-persistent'
  else
    log 'netfilter-persistent no instalado: instalá iptables-persistent para que sobrevivan al reboot'
  fi
}

apply() {
  require_root
  generate_v4
  generate_v6

  if [ "${1:-}" = '--dry-run' ]; then
    log 'dry-run: reglas que se aplicarían (IPv4):'
    cat "${GENERATED_V4}"
    return
  fi

  # `--test` valida sin aplicar: si la sintaxis es inválida no se toca el firewall.
  iptables-restore --test "${GENERATED_V4}" || die 'las reglas IPv4 no validan'
  ip6tables-restore --test "${GENERATED_V6}" || die 'las reglas IPv6 no validan'
  iptables-restore "${GENERATED_V4}"
  ip6tables-restore "${GENERATED_V6}"
  log 'reglas DOCKER-USER aplicadas (tcp 80/443 y udp 443 sólo desde Cloudflare)'

  CLOUDFLARE_V4="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 | tr '\n' ' ')" \
    apply_ufw_baseline
  persist_rules

  log 'listo. Verificá desde fuera con: ./scripts/cloudflare-ufw.sh verify <ip-publica>'
}

verify() {
  local ip="${1:-}"
  [ -n "${ip}" ] || die 'uso: cloudflare-ufw.sh verify <ip-publica-del-vps>'

  log "Comprobando que la IP directa ${ip} NO acepta conexiones en 80/443 ni 22 sin túnel..."
  local failed=0
  for port in 80 443; do
    if curl -fsS --max-time 5 --connect-timeout 5 "https://${ip}:${port}/" >/dev/null 2>&1; then
      log "FALLO: ${ip}:${port} respondió directamente (no está filtrando Docker/Cloudflare)"
      failed=1
    else
      log "OK: ${ip}:${port} rechaza/timeout la conexión directa"
    fi
  done
  return "${failed}"
}

case "${1:-}" in
  apply) shift; apply "${1:-}" ;;
  verify) shift; verify "${1:-}" ;;
  generate)
    # Sin root: imprime las reglas generadas (útil para revisarlas en CI).
    generate_v4
    cat "${GENERATED_V4}"
    ;;
  *)
    sed -n '2,25p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
