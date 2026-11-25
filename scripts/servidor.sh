#!/usr/bin/env bash
# Utilidades para el servidor casero de EConsultor (Ubuntu + Docker + Tailscale).
# Se ejecuta DENTRO del servidor, en la carpeta del proyecto:
#
#   bash scripts/servidor.sh informe          Informe claro del servidor y de la base de datos
#   bash scripts/servidor.sh actividad [días] Qué ha pasado en la base de datos (usuarios nuevos, entradas, avisos)
#   bash scripts/servidor.sh copias           Configura las copias de seguridad cifradas (restic) y hace la primera
#   bash scripts/servidor.sh copiar           Hace una copia ahora (la tarea nocturna usa este comando)
#   bash scripts/servidor.sh restaurar [ID]   Lista las copias o restaura una (pide confirmación)
#   bash scripts/servidor.sh estado           Resumen técnico corto, para pegarlo en el chat
#   bash scripts/servidor.sh actualizar       Descarga cambios de GitHub y reconstruye si los hay
#   bash scripts/servidor.sh actualizaciones  Programa `actualizar` cada 10 minutos (cron)
#   bash scripts/servidor.sh publico          Abre la app a internet con Tailscale Funnel
#   bash scripts/servidor.sh privado          Vuelve a dejarla solo dentro de tu red de Tailscale
#   bash scripts/servidor.sh panel            Instala/actualiza el panel personal (web con gráficos, solo para ti)
#   bash scripts/servidor.sh panel-clave      Genera una contraseña nueva para el panel
#   bash scripts/servidor.sh panel-parar      Apaga el panel y lo quita de Tailscale
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
PUERTO=8787
REPO="${HOME}/backups"                                  # repositorio de copias (cifrado con restic)
CLAVE_RESTIC="${HOME}/.config/econsultor/restic-pass"   # contraseña del repositorio (solo tu usuario la lee)

# ───────── ayudas de presentación ─────────
titulo() { printf '\n%s\n%s\n' "$1" "$(printf '─%.0s' $(seq 1 ${#1}))"; }
ok() { echo "[OK] $*"; }
aviso() { echo "[AVISO] $*"; }
alerta() { echo "[ALERTA] $*"; }

# `docker compose` con el panel incluido si ya se instaló (existe .env.panel).
compose() {
  if [ -f "${DIR}/.env.panel" ]; then docker compose --profile panel "$@"; else docker compose "$@"; fi
}

app_encendida() { docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -q '^app running'; }

# ───────── informe del servidor + base de datos ─────────
informe() {
  echo "INFORME DE EConsultor · $(TZ=Europe/Berlin date '+%Y-%m-%d %H:%M') (hora de Berlín)"

  titulo "SERVIDOR"
  echo "Sistema: $(lsb_release -ds 2>/dev/null || echo 'desconocido')"
  echo "Encendido desde hace: $(uptime -p | sed -e 's/^up //' -e 's/\b1 week\b/1 semana/' -e 's/\b1 day\b/1 día/' -e 's/\b1 hour\b/1 hora/' -e 's/\b1 minute\b/1 min/' -e 's/weeks\?/semanas/' -e 's/days\?/días/' -e 's/hours\?/horas/' -e 's/minutes\?/min/')"

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
    local salud
    salud="$(docker compose ps --format '{{.Health}}' app 2>/dev/null | head -1)"
    if [ "$salud" = "healthy" ]; then ok "El contenedor de la app está encendido y sano."
    else aviso "El contenedor de la app está encendido pero su comprobación de salud dice «${salud:-desconocido}». Si acaba de arrancar, espera un minuto y repite."; fi
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
  if [ -f "$REPO/config" ]; then
    local ultima n horas
    n="$(find "$REPO/snapshots" -type f 2>/dev/null | wc -l)"
    ultima="$(find "$REPO/snapshots" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"
    if [ -n "$ultima" ]; then
      horas=$(( ( $(date +%s) - ultima ) / 3600 ))
      if [ "$horas" -le 36 ]; then ok "La última copia es de hace ${horas} h (hay ${n} guardadas)."
      else aviso "La última copia tiene ${horas} horas. Mira el registro: tail ~/econsultor-copias.log"; fi
    else
      aviso "El repositorio de copias existe pero aún no tiene ninguna copia (bash scripts/servidor.sh copiar)."
    fi
    if crontab -l 2>/dev/null | grep -q 'servidor.sh copiar'; then ok "Copia automática cada noche: activada."
    else aviso "La copia automática no está programada (se programa con 'bash scripts/servidor.sh copias')."; fi
    echo "Recuerda: una copia solo en este mismo disco no te salva si el disco se estropea. Guarda otra fuera del servidor,"
    echo "y guarda DATA_ENCRYPTION_KEY y la contraseña de las copias en un sitio aparte (sin ellas, las copias no sirven)."
  else
    aviso "Las copias de seguridad no están configuradas. Se activan con: bash scripts/servidor.sh copias"
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

# ───────── copias de seguridad (restic) ─────────
restic_env() { export RESTIC_REPOSITORY="$REPO" RESTIC_PASSWORD_FILE="$CLAVE_RESTIC"; }

copias() {
  if ! app_encendida; then alerta "La app debe estar encendida para copiarla (docker compose up -d)."; exit 1; fi
  command -v restic >/dev/null 2>&1 || { echo "Instalando restic..."; sudo apt-get install -y restic; }

  local nueva=0
  if [ ! -f "$CLAVE_RESTIC" ]; then
    if [ -e "$REPO/config" ]; then
      alerta "Ya existe un repositorio de copias en ${REPO} pero falta su contraseña (${CLAVE_RESTIC}). No genero otra: sin la original no se puede leer."
      exit 1
    fi
    mkdir -p "$(dirname "$CLAVE_RESTIC")"
    ( umask 077; openssl rand -hex 24 > "$CLAVE_RESTIC" )
    nueva=1
  fi
  chmod 600 "$CLAVE_RESTIC"
  restic_env
  if ! restic cat config >/dev/null 2>&1; then restic init; fi

  if [ "$nueva" = 1 ]; then
    titulo "CONTRASEÑA DE LAS COPIAS: GUÁRDALA AHORA"
    cat "$CLAVE_RESTIC"
    echo
    echo "Sin esta contraseña no se puede recuperar ninguna copia, y este archivo se pierde con el servidor si se estropea."
    echo "Guárdala en tu gestor de contraseñas. Si la pierdes de la pantalla, está en: ${CLAVE_RESTIC}"
    if [ -t 0 ]; then read -r -p "Pulsa Enter cuando la hayas guardado... " _; fi
  fi

  copiar || aviso "La primera copia no se ha podido hacer todavía (por ejemplo, si aún no hay datos). La tarea nocturna lo reintentará."

  local tarea="30 3 * * * ${DIR}/scripts/servidor.sh copiar >> ${HOME}/econsultor-copias.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'servidor.sh copiar' || true; echo "$tarea" ) | crontab -

  titulo "LISTO"
  ok "Copia automática programada cada noche a las 03:30. Se conservan 7 diarias, 4 semanales y 6 mensuales."
  echo "Registro: ${HOME}/econsultor-copias.log · Copias: ${REPO}"
  echo
  echo "Falta lo más importante: una copia FUERA de este ordenador. Desde PowerShell en tu PC, de vez en cuando:"
  echo "  scp -r $(id -un)@$(hostname -I | awk '{print $1}'):backups C:\\Copias\\econsultor"
  echo "Y guarda DATA_ENCRYPTION_KEY (está en el archivo .env) en un sitio aparte: sin ella, ninguna copia de los datos se puede leer."
}

copiar() {
  restic_env
  [ -f "$CLAVE_RESTIC" ] || { alerta "Las copias no están configuradas. Ejecuta: bash scripts/servidor.sh copias"; exit 1; }
  app_encendida || { alerta "La app no está encendida: no se puede copiar."; exit 1; }
  docker compose exec -T app test -s /data/store.json || { alerta "Todavía no hay datos que copiar (/data/store.json no existe o está vacío)."; exit 1; }
  echo "$(date -Is) Copiando la base de datos..."
  docker compose exec -T app cat /data/store.json | restic backup --stdin --stdin-filename store.json --tag econsultor --quiet
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune --quiet
  echo "$(date -Is) Copia hecha."
}

restaurar() {
  restic_env
  [ -f "$CLAVE_RESTIC" ] || { alerta "Las copias no están configuradas. Ejecuta: bash scripts/servidor.sh copias"; exit 1; }
  local id="${1:-}"
  if [ -z "$id" ]; then
    echo "Copias disponibles:"
    restic snapshots --compact
    echo
    echo "Para restaurar una: bash scripts/servidor.sh restaurar <ID>   (o 'latest' para la más reciente)"
    return 0
  fi

  # Variable global: la limpieza (trap) se ejecuta al salir del script, cuando las locales ya no existen.
  tmp="$(mktemp -d)"
  chmod 755 "$tmp"
  trap 'rm -rf "${tmp:-}"' EXIT
  restic dump "$id" /store.json > "$tmp/store.json" || { alerta "No he podido leer esa copia. ¿Es correcto el ID?"; exit 1; }
  [ -s "$tmp/store.json" ] || { alerta "La copia está vacía: no restauro nada."; exit 1; }
  chmod 644 "$tmp/store.json"

  echo "Esto SUSTITUIRÁ los datos actuales por los de la copia «${id}» ($(wc -c < "$tmp/store.json") bytes)."
  echo "Antes se guardará un respaldo de los datos actuales dentro del volumen (store.json.antes-de-restaurar)."
  local r
  read -r -p "Escribe SI para continuar: " r
  [ "$r" = "SI" ] || { echo "Cancelado: no he cambiado nada."; exit 0; }

  docker compose stop app
  docker compose run --rm --no-deps -v "$tmp:/restore:ro" --entrypoint sh app -c \
    'if [ -f /data/store.json ]; then cp /data/store.json /data/store.json.antes-de-restaurar; fi; cp /restore/store.json /data/store.json'
  docker compose up -d app
  echo "Restaurado. Comprueba que todo está bien con: bash scripts/servidor.sh informe"
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
    compose up -d --build
    docker image prune -f >/dev/null
    echo "$(date -Is) Listo: $(git log -1 --format='%h %s')"
  fi
}

actualizaciones() {
  local tarea="*/10 * * * * ${DIR}/scripts/servidor.sh actualizar >> ${HOME}/econsultor-actualizar.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v 'servidor.sh actualizar' || true; echo "$tarea" ) | crontab -
  echo "Programado: cada 10 minutos se comprobará GitHub. Registro en ${HOME}/econsultor-actualizar.log"
}

# Comprueba que el panel NO está en Funnel. Devuelve 0 = a salvo, 1 = expuesto, 2 = no se pudo comprobar.
panel_expuesto() {
  tailscale serve status --json 2>/dev/null | python3 -c '
import json, sys
try:
    c = json.load(sys.stdin)
except Exception:
    sys.exit(2)
publico = c.get("AllowFunnel") or {}
for hp, web in (c.get("Web") or {}).items():
    for h in (web.get("Handlers") or {}).values():
        if ":8788" in str(h.get("Proxy", "")) and publico.get(hp):
            sys.exit(1)
sys.exit(0)'
}

avisar_si_panel_expuesto() {
  [ -f "${DIR}/.env.panel" ] || return 0
  local r=0
  panel_expuesto || r=$?
  if [ "$r" -eq 1 ]; then
    alerta "El PANEL está abierto a internet. Ciérralo ya con: sudo tailscale serve --https=8443 off && bash scripts/servidor.sh panel"
  elif [ "$r" -eq 0 ]; then
    ok "El panel sigue siendo privado (solo tu red de Tailscale)."
  fi
}

publico() {
  echo "Abriendo la app a internet con Tailscale Funnel..."
  echo "Si es la primera vez, te mostrará un enlace para activar Funnel: ábrelo en el navegador y vuelve a ejecutar este comando."
  sudo tailscale funnel --bg "${PUERTO}"
  avisar_si_panel_expuesto
}

privado() {
  # Solo se cierra el puerto 443 (la app). El panel, en el 8443, no se toca.
  sudo tailscale funnel --https=443 off || true
  sudo tailscale serve --bg --https=443 "http://127.0.0.1:${PUERTO}"
  if tailscale serve status 2>/dev/null | grep -q 'Funnel on'; then
    aviso "Algo sigue abierto a internet. Revisa: tailscale serve status"
  else
    echo "La app vuelve a ser accesible solo desde tu red de Tailscale."
  fi
  avisar_si_panel_expuesto
}

# ───────── panel personal ─────────
CRON_PANEL="* * * * * python3 ${DIR}/scripts/panel-recolector.py >/dev/null 2>>${DIR}/estado/recolector.log"

panel_url() {
  tailscale status --json 2>/dev/null | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))
except Exception:
    pass' || true
}

panel_clave_nueva() {
  local nueva ver="${1:-false}"
  nueva="$(openssl rand -hex 16)"
  ( umask 077; printf 'PANEL_PASSWORD=%s\nPANEL_VER_IMPORTES=%s\n' "$nueva" "$ver" > "${DIR}/.env.panel" )
  chmod 600 "${DIR}/.env.panel"
  echo "$nueva"
}

panel() {
  command -v python3 >/dev/null || { alerta "Falta python3 (sudo apt install python3)."; exit 1; }
  command -v openssl >/dev/null || { alerta "Falta openssl (sudo apt install openssl)."; exit 1; }
  mkdir -p "${DIR}/estado"; chmod 755 "${DIR}/estado"

  local clave=""
  if ! grep -q '^PANEL_PASSWORD=' "${DIR}/.env.panel" 2>/dev/null; then
    clave="$(panel_clave_nueva)"
  fi

  # El recolector usa Tailscale sin sudo si tu usuario es el «operador».
  sudo tailscale set --operator="$(id -un)" >/dev/null 2>&1 || aviso "No pude dar permiso a tu usuario sobre Tailscale; el panel no podrá mostrar esa parte."

  ( crontab -l 2>/dev/null | grep -v 'panel-recolector.py' || true; echo "$CRON_PANEL" ) | crontab -
  python3 "${DIR}/scripts/panel-recolector.py" || aviso "El recolector falló; mira ${DIR}/estado/recolector.log"

  echo "Construyendo y arrancando el panel (la primera vez tarda un par de minutos)..."
  compose up -d --build panel

  local i
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8788/healthz >/dev/null 2>&1; then break; fi
    sleep 2
  done
  curl -fsS http://127.0.0.1:8788/healthz >/dev/null 2>&1 || { alerta "El panel no arrancó. Mira: docker compose --profile panel logs panel"; exit 1; }

  # Solo dentro de tu red privada (Serve), en el puerto 8443. La app sigue en el 443.
  sudo tailscale serve --bg --https=8443 "http://127.0.0.1:8788"

  titulo "PANEL LISTO"
  local dominio
  dominio="$(panel_url)"
  [ -n "$dominio" ] && echo "Ábrelo desde cualquier dispositivo con Tailscale:  https://${dominio}:8443"
  if [ -n "$clave" ]; then
    echo
    echo "Contraseña del panel (guárdala en tu gestor de contraseñas; no se vuelve a mostrar sola):"
    echo "    ${clave}"
    echo "Si la pierdes: bash scripts/servidor.sh panel-clave"
  else
    echo "La contraseña es la que ya tenías. Para cambiarla: bash scripts/servidor.sh panel-clave"
  fi
  echo
  avisar_si_panel_expuesto
}

panel_clave() {
  [ -f "${DIR}/.env.panel" ] || { alerta "El panel aún no está instalado: bash scripts/servidor.sh panel"; exit 1; }
  local ver
  ver="$(grep '^PANEL_VER_IMPORTES=' "${DIR}/.env.panel" | cut -d= -f2 || true)"
  local nueva
  nueva="$(panel_clave_nueva "${ver:-false}")"
  compose up -d --force-recreate panel
  echo "Contraseña nueva del panel (las sesiones abiertas se cierran):"
  echo "    ${nueva}"
}

panel_parar() {
  ( crontab -l 2>/dev/null | grep -v 'panel-recolector.py' || true ) | crontab -
  compose rm -sf panel >/dev/null 2>&1 || true
  sudo tailscale serve --https=8443 off >/dev/null 2>&1 || true
  echo "Panel apagado y fuera de Tailscale. Tu contraseña y los datos recogidos siguen en ${DIR} (.env.panel y estado/)."
  echo "Para volver a encenderlo: bash scripts/servidor.sh panel"
}

case "${1:-ayuda}" in
  informe) informe ;;
  actividad) actividad "${2:-7}" ;;
  copias) copias ;;
  copiar) copiar ;;
  restaurar) restaurar "${2:-}" ;;
  estado) estado ;;
  actualizar) actualizar ;;
  actualizaciones) actualizaciones ;;
  publico) publico ;;
  privado) privado ;;
  panel) panel ;;
  panel-clave) panel_clave ;;
  panel-parar) panel_parar ;;
  *) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
esac
