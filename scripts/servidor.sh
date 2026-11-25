#!/usr/bin/env bash
# Utilidades para el servidor casero de EConsultor (Ubuntu + Docker + Tailscale).
# Se ejecuta DENTRO del servidor, en la carpeta del proyecto:
#
#   bash scripts/servidor.sh informe          Informe claro del servidor y de la base de datos
#   bash scripts/servidor.sh actividad [días] Qué ha pasado en la base de datos (usuarios nuevos, entradas, avisos)
#   bash scripts/servidor.sh estado           Resumen técnico corto, para pegarlo en el chat
#   bash scripts/servidor.sh actualizar       Descarga cambios de GitHub y reconstruye si los hay
#   bash scripts/servidor.sh actualizaciones  Programa `actualizar` cada 10 minutos (cron)
#   bash scripts/servidor.sh publico          Abre la app a internet con Tailscale Funnel
#   bash scripts/servidor.sh privado          Vuelve a dejarla solo dentro de tu red de Tailscale
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
PUERTO=8787

# ───────── ayudas de presentación ─────────
titulo() { printf '\n%s\n%s\n' "$1" "$(printf '─%.0s' $(seq 1 ${#1}))"; }
ok() { echo "[OK] $*"; }
aviso() { echo "[AVISO] $*"; }
alerta() { echo "[ALERTA] $*"; }

app_encendida() { docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -q '^app running'; }

# ───────── informe del servidor + base de datos ─────────
informe() {
  echo "INFORME DE EConsultor · $(date '+%Y-%m-%d %H:%M') (hora del servidor)"

  titulo "SERVIDOR"
  echo "Sistema: $(lsb_release -ds 2>/dev/null || echo 'desconocido')"
  echo "Encendido desde hace: $(uptime -p | sed -e 's/^up //' -e 's/weeks\?/semanas/' -e 's/days\?/días/' -e 's/hours\?/horas/' -e 's/minutes\?/min/')"

  local mem disco
  mem="$(free -m | awk '/^Mem:/ {printf "%d", ($2-$7)*100/$2}')"
  if [ "$mem" -ge 85 ]; then aviso "Memoria en uso: ${mem}%. Va justa: si se llena, el sistema empezará a cerrar programas."
  else ok "Memoria en uso: ${mem}% (lo normal es estar por debajo del 85%)."; fi

  disco="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
  if [ "$disco" -ge 90 ]; then alerta "Disco lleno al ${disco}%. Hay que liberar espacio ya."
  elif [ "$disco" -ge 80 ]; then aviso "Disco lleno al ${disco}%. Conviene revisar qué ocupa."
  else ok "Disco ocupado al ${disco}%."; fi

  local pend
  pend="$( (apt list --upgradable 2>/dev/null || true) | grep -c upgradable || true)"
  if [ "${pend:-0}" -gt 0 ]; then aviso "Hay ${pend} actualizaciones del sistema pendientes (las de seguridad se instalan solas; el resto, con 'sudo apt update && sudo apt full-upgrade')."
  else ok "El sistema está al día."; fi
  if [ -f /var/run/reboot-required ]; then aviso "El sistema pide reiniciar para terminar de actualizarse ('sudo reboot')."; fi

  titulo "LA APP"
  if app_encendida; then
    ok "El contenedor de la app está encendido ($(docker compose ps --format '{{.Health}}' app 2>/dev/null | head -1))."
  else
    alerta "El contenedor de la app NO está encendido. Prueba: docker compose up -d"
  fi
  if curl -fs -m 5 -o /dev/null "http://127.0.0.1:${PUERTO}/healthz"; then ok "La app responde correctamente."
  else alerta "La app no responde en el puerto ${PUERTO}."; fi
  echo "Versión instalada: $(git log -1 --format='%h «%s», %cr')"

  git fetch -q origin 2>/dev/null || true
  local rama
  rama="$(git rev-parse --abbrev-ref HEAD)"
  if git rev-parse "origin/${rama}" >/dev/null 2>&1 && [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/${rama}")" ]; then
    aviso "Hay una versión más nueva en GitHub. Se instalará con 'bash scripts/servidor.sh actualizar' (o sola, si tienes las actualizaciones automáticas)."
  else
    ok "Tienes la última versión del código."
  fi
  if crontab -l 2>/dev/null | grep -q 'servidor.sh actualizar'; then ok "Actualizaciones automáticas: activadas."
  else aviso "Actualizaciones automáticas: desactivadas (se activan con 'bash scripts/servidor.sh actualizaciones')."; fi

  titulo "ACCESO DESDE FUERA"
  if tailscale status >/dev/null 2>&1; then ok "Tailscale está conectado."; else alerta "Tailscale no está conectado."; fi
  local serve
  serve="$(tailscale serve status 2>&1 || true)"
  if echo "$serve" | grep -qi 'funnel on'; then
    aviso "La app está PÚBLICA en internet (Funnel). Cualquiera con la dirección puede abrirla."
  elif echo "$serve" | grep -qi 'tailnet only'; then
    ok "La app es PRIVADA: solo la ven tus dispositivos con Tailscale."
  else
    echo "No he podido saber si es pública o privada. Esto es lo que dice Tailscale:"
    echo "$serve" | head -5
  fi
  echo "$serve" | grep -oE 'https://[^ ]+' | head -1 | sed 's/^/Dirección: /' || true

  titulo "COPIAS DE SEGURIDAD"
  local copias="${HOME}/backups"
  if [ -d "$copias" ]; then
    local ultima
    ultima="$(find "$copias" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"
    if [ -n "$ultima" ]; then
      local horas=$(( ( $(date +%s) - ultima ) / 3600 ))
      if [ "$horas" -le 36 ]; then ok "La carpeta de copias se actualizó hace ${horas} h."
      else aviso "La última copia tiene ${horas} horas. Revisa que la tarea nocturna de restic esté funcionando."; fi
    else
      aviso "La carpeta de copias existe pero está vacía."
    fi
    echo "Recuerda: una copia solo en este mismo disco no te salva si el disco se estropea. Guarda otra fuera del servidor."
  else
    aviso "No encuentro la carpeta ${copias}. Si ya hiciste las copias con restic en otra ruta, ignora este aviso; si no, están pendientes."
  fi

  if app_encendida; then
    docker compose exec -T app node dist/informe.js base
  else
    titulo "BASE DE DATOS"
    alerta "No puedo leer la base de datos porque el contenedor de la app no está encendido."
  fi

  titulo "PARA ENTENDERLO MEJOR"
  echo "[OK] = todo bien · [AVISO] = conviene mirarlo, no es urgente · [ALERTA] = hay que actuar."
  echo "Para ver quién se ha registrado o intentado entrar: bash scripts/servidor.sh actividad"
}

actividad() {
  if app_encendida; then
    docker compose exec -T app node dist/informe.js actividad "${1:-7}"
  else
    alerta "No puedo leer la base de datos porque el contenedor de la app no está encendido (docker compose up -d)."
    exit 1
  fi
}

# ───────── resumen técnico corto ─────────
estado() {
  echo "== Sistema =="
  lsb_release -ds 2>/dev/null || true
  uptime -p
  free -h | sed -n '1,2p'
  df -h / | tail -1
  echo
  echo "== Contenedores =="
  docker compose ps
  echo
  echo "== Salud de la app =="
  if curl -fsS -m 5 "http://127.0.0.1:${PUERTO}/healthz"; then echo; else echo "NO responde"; fi
  echo
  echo "== Tailscale =="
  tailscale status 2>&1 | head -6 || true
  tailscale serve status 2>&1 | head -8 || true
  echo
  echo "== Versión del código =="
  git log -1 --format='%h %s (%cr)'
  echo
  echo "== Últimas líneas del registro de la app =="
  docker compose logs --tail 15 app 2>&1 | sed -E 's/((secret|key|token|password|authorization)[A-Za-z_]*\"? *[=:] *\"?)[^ ,\"]+/\1***/Ig' || true
}

actualizar() {
  # Evita que dos ejecuciones se pisen (por ejemplo, una a mano y otra de cron).
  exec 9>/tmp/econsultor-actualizar.lock
  flock -n 9 || exit 0
  git fetch -q origin
  local rama
  rama="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/${rama}")" ]; then
    echo "$(date -Is) Hay cambios en origin/${rama}: actualizando"
    git pull -q --ff-only origin "${rama}"
    docker compose up -d --build
    docker image prune -f >/dev/null
    echo "$(date -Is) Listo: $(git log -1 --format='%h %s')"
  fi
}

actualizaciones() {
  local tarea="*/10 * * * * ${DIR}/scripts/servidor.sh actualizar >> ${HOME}/econsultor-actualizar.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'servidor.sh actualizar' || true; echo "$tarea" ) | crontab -
  echo "Programado: cada 10 minutos se comprobará GitHub. Registro en ${HOME}/econsultor-actualizar.log"
}

publico() {
  echo "Abriendo la app a internet con Tailscale Funnel..."
  echo "Si es la primera vez, te mostrará un enlace para activar Funnel: ábrelo en el navegador y vuelve a ejecutar este comando."
  sudo tailscale funnel --bg "${PUERTO}"
}

privado() {
  sudo tailscale funnel reset
  sudo tailscale serve --bg "${PUERTO}"
  echo "La app vuelve a ser accesible solo desde tu red de Tailscale."
}

case "${1:-ayuda}" in
  informe) informe ;;
  actividad) actividad "${2:-7}" ;;
  estado) estado ;;
  actualizar) actualizar ;;
  actualizaciones) actualizaciones ;;
  publico) publico ;;
  privado) privado ;;
  *) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
